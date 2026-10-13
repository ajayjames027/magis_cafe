import os
import io
import socket
from datetime import datetime, date, timedelta
from flask import Flask, render_template, request, jsonify, send_file
import sqlite3
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from werkzeug.utils import secure_filename

from database import init_db, seed_initial_students_if_empty, get_db_connection
from importer import preview_excel_file, import_students_from_excel

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Initialize database on startup
init_db()
seed_initial_students_if_empty()

def get_local_ip():
    """Get LAN IP address for mobile access."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

def get_current_meal_session():
    """Detect current meal session based on local time."""
    now = datetime.now()
    minutes = now.hour * 60 + now.minute
    
    # 7:00 AM - 10:30 AM -> Breakfast
    if 420 <= minutes < 630:
        return 'Breakfast'
    # 10:30 AM - 3:30 PM -> Lunch
    elif 630 <= minutes < 930:
        return 'Lunch'
    # 3:30 PM - 7:00 PM -> Snacks
    elif 930 <= minutes < 1140:
        return 'Snacks'
    # 7:00 PM - 11:00 PM -> Dinner
    elif 1140 <= minutes < 1380:
        return 'Dinner'
    else:
        return 'Dinner' if minutes >= 1140 else 'Breakfast'

# ----------------- PAGE ROUTES ----------------- #

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/report/print')
def print_report():
    conn = get_db_connection()
    cursor = conn.cursor()

    req_date = request.args.get('date', date.today().isoformat())
    start_date = request.args.get('start_date', '')
    end_date = request.args.get('end_date', '')
    meal = request.args.get('meal_session', '')
    violation = request.args.get('violation_type', '')
    batch = request.args.get('batch', '')

    query = '''
        SELECT l.*, s.roll_no, s.name as student_name, s.batch, s.gender, s.mobile
        FROM food_logs l
        JOIN students s ON l.student_id = s.id
        WHERE 1=1
    '''
    params = []

    if start_date and end_date:
        query += ' AND l.log_date BETWEEN ? AND ?'
        params.extend([start_date, end_date])
        date_title = f"{start_date} to {end_date}"
    elif req_date:
        query += ' AND l.log_date = ?'
        params.append(req_date)
        date_title = req_date
    else:
        date_title = "All Time"

    if meal and meal != 'All':
        query += ' AND l.meal_session = ?'
        params.append(meal)

    if violation and violation != 'All':
        query += ' AND l.violation_type = ?'
        params.append(violation)

    if batch and batch != 'All':
        query += ' AND s.batch = ?'
        params.append(batch)

    query += ' ORDER BY l.log_date DESC, l.id DESC'

    cursor.execute(query, params)
    logs = [dict(r) for r in cursor.fetchall()]

    # Aggregates
    total_logs = len(logs)
    hand_count = sum(1 for l in logs if l['violation_type'] in ('eat_in_hand', 'both'))
    waste_count = sum(1 for l in logs if l['violation_type'] in ('waste_food', 'both'))
    unique_students = len(set(l['student_id'] for l in logs))

    conn.close()

    return render_template(
        'print_report.html',
        logs=logs,
        date_title=date_title,
        meal=meal or 'All Meals',
        batch=batch or 'All Batches',
        total_logs=total_logs,
        hand_count=hand_count,
        waste_count=waste_count,
        unique_students=unique_students,
        generated_at=datetime.now().strftime('%d %b %Y, %I:%M %p')
    )

# ----------------- API ROUTES ----------------- #

@app.route('/api/session-info')
def api_session_info():
    ip = get_local_ip()
    port = 5000
    return jsonify({
        'current_date': date.today().isoformat(),
        'current_time': datetime.now().strftime('%I:%M %p'),
        'detected_meal': get_current_meal_session(),
        'local_ip': ip,
        'local_port': port,
        'mobile_url': f"http://{ip}:{port}"
    })

@app.route('/api/batches')
def api_batches():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        SELECT batch, COUNT(*) as count 
        FROM students 
        WHERE is_active = 1 
        GROUP BY batch 
        ORDER BY batch ASC
    ''')
    batches = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(batches)

@app.route('/api/students')
def api_students():
    search = request.args.get('search', '').strip()
    batch = request.args.get('batch', '').strip()
    log_date = request.args.get('date', date.today().isoformat())
    meal_session = request.args.get('meal_session', '')

    conn = get_db_connection()
    cursor = conn.cursor()

    query = '''
        SELECT s.*,
            (SELECT COUNT(*) FROM food_logs l WHERE l.student_id = s.id AND l.log_date = ?) as today_logs_count,
            (SELECT violation_type FROM food_logs l 
             WHERE l.student_id = s.id AND l.log_date = ? AND (? = '' OR l.meal_session = ?)
             ORDER BY l.id DESC LIMIT 1) as current_meal_violation
        FROM students s
        WHERE s.is_active = 1
    '''
    params = [log_date, log_date, meal_session, meal_session]

    if batch and batch != 'All':
        query += ' AND s.batch = ?'
        params.append(batch)

    if search:
        query += ' AND (s.roll_no LIKE ? OR s.name LIKE ? OR s.mobile LIKE ?)'
        like_str = f'%{search}%'
        params.extend([like_str, like_str, like_str])

    query += ' ORDER BY s.roll_no ASC'

    cursor.execute(query, params)
    students = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify(students)

@app.route('/api/students', methods=['POST'])
def api_create_student():
    data = request.get_json() or {}
    roll_no = data.get('roll_no', '').strip().upper()
    name = data.get('name', '').strip().upper()
    batch = data.get('batch', 'I MBA').strip()
    mobile = data.get('mobile', '').strip()
    gender = data.get('gender', 'M').strip().upper()

    if not roll_no or not name:
        return jsonify({'error': 'Roll Number and Name are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO students (roll_no, name, batch, mobile, gender)
            VALUES (?, ?, ?, ?, ?)
        ''', (roll_no, name, batch, mobile, gender))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()
        return jsonify({'success': True, 'id': new_id, 'message': f'Student {name} ({roll_no}) added successfully.'})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': f'Roll Number {roll_no} already exists.'}), 400
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/students/<int:student_id>', methods=['PUT'])
def api_update_student(student_id):
    data = request.get_json() or {}
    roll_no = data.get('roll_no', '').strip().upper()
    name = data.get('name', '').strip().upper()
    batch = data.get('batch', 'I MBA').strip()
    mobile = data.get('mobile', '').strip()
    gender = data.get('gender', 'M').strip().upper()

    if not roll_no or not name:
        return jsonify({'error': 'Roll Number and Name are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE students
            SET roll_no = ?, name = ?, batch = ?, mobile = ?, gender = ?
            WHERE id = ?
        ''', (roll_no, name, batch, mobile, gender, student_id))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'message': 'Student updated successfully.'})
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': f'Roll Number {roll_no} is already used by another student.'}), 400
    except Exception as e:
        conn.close()
        return jsonify({'error': str(e)}), 500

@app.route('/api/students/<int:student_id>', methods=['DELETE'])
def api_delete_student(student_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM students WHERE id = ?', (student_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Student deleted successfully.'})

@app.route('/api/logs', methods=['GET'])
def api_get_logs():
    req_date = request.args.get('date', '').strip()
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()
    meal = request.args.get('meal_session', '').strip()
    violation = request.args.get('violation_type', '').strip()
    batch = request.args.get('batch', '').strip()
    search = request.args.get('search', '').strip()
    limit = request.args.get('limit', 300, type=int)

    conn = get_db_connection()
    cursor = conn.cursor()

    query = '''
        SELECT l.*, s.roll_no, s.name as student_name, s.batch, s.gender, s.mobile
        FROM food_logs l
        JOIN students s ON l.student_id = s.id
        WHERE 1=1
    '''
    params = []

    if start_date and end_date:
        query += ' AND l.log_date BETWEEN ? AND ?'
        params.extend([start_date, end_date])
    elif req_date:
        query += ' AND l.log_date = ?'
        params.append(req_date)

    if meal and meal != 'All':
        query += ' AND l.meal_session = ?'
        params.append(meal)

    if violation and violation != 'All':
        query += ' AND l.violation_type = ?'
        params.append(violation)

    if batch and batch != 'All':
        query += ' AND s.batch = ?'
        params.append(batch)

    if search:
        query += ' AND (s.roll_no LIKE ? OR s.name LIKE ? OR l.remarks LIKE ?)'
        like_str = f'%{search}%'
        params.extend([like_str, like_str, like_str])

    query += ' ORDER BY l.log_date DESC, l.id DESC LIMIT ?'
    params.append(limit)

    cursor.execute(query, params)
    logs = [dict(r) for r in cursor.fetchall()]

    # Summary calculations for current filter
    total_logs = len(logs)
    eat_in_hand_count = sum(1 for l in logs if l['violation_type'] == 'eat_in_hand')
    waste_food_count = sum(1 for l in logs if l['violation_type'] == 'waste_food')
    both_count = sum(1 for l in logs if l['violation_type'] == 'both')
    unique_students_count = len(set(l['student_id'] for l in logs))

    conn.close()

    return jsonify({
        'logs': logs,
        'summary': {
            'total': total_logs,
            'eat_in_hand': eat_in_hand_count,
            'waste_food': waste_food_count,
            'both': both_count,
            'unique_students': unique_students_count
        }
    })

@app.route('/api/logs', methods=['POST'])
def api_create_logs():
    data = request.get_json() or {}
    student_ids = data.get('student_ids', [])
    log_date = data.get('log_date', date.today().isoformat())
    meal_session = data.get('meal_session', get_current_meal_session())
    violation_type = data.get('violation_type', 'waste_food')
    waste_severity = data.get('waste_severity', 'Normal')
    remarks = data.get('remarks', '').strip()
    logged_by = data.get('logged_by', 'Food Committee')

    if not student_ids:
        return jsonify({'error': 'No students selected'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    created_ids = []
    recorded_names = []

    for sid in student_ids:
        cursor.execute('''
            INSERT INTO food_logs (student_id, log_date, meal_session, violation_type, waste_severity, remarks, logged_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (sid, log_date, meal_session, violation_type, waste_severity, remarks, logged_by))
        created_ids.append(cursor.lastrowid)

        cursor.execute('SELECT roll_no, name FROM students WHERE id = ?', (sid,))
        st = cursor.fetchone()
        if st:
            recorded_names.append(f"{st['roll_no']} ({st['name']})")

    conn.commit()
    conn.close()

    return jsonify({
        'success': True,
        'count': len(created_ids),
        'created_ids': created_ids,
        'recorded_students': recorded_names,
        'message': f"Logged {len(created_ids)} student(s) for {meal_session} on {log_date}."
    })

@app.route('/api/logs/<int:log_id>', methods=['DELETE'])
def api_delete_log(log_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM food_logs WHERE id = ?', (log_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Log entry removed successfully.'})

@app.route('/api/logs/<int:log_id>', methods=['PUT'])
def api_update_log(log_id):
    data = request.get_json() or {}
    violation_type = data.get('violation_type')
    waste_severity = data.get('waste_severity')
    remarks = data.get('remarks')
    meal_session = data.get('meal_session')

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE food_logs
        SET violation_type = COALESCE(?, violation_type),
            waste_severity = COALESCE(?, waste_severity),
            remarks = COALESCE(?, remarks),
            meal_session = COALESCE(?, meal_session)
        WHERE id = ?
    ''', (violation_type, waste_severity, remarks, meal_session, log_id))
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'message': 'Log entry updated.'})

@app.route('/api/analytics')
def api_analytics():
    conn = get_db_connection()
    cursor = conn.cursor()

    today_str = date.today().isoformat()
    week_ago_str = (date.today() - timedelta(days=7)).isoformat()
    month_ago_str = (date.today() - timedelta(days=30)).isoformat()

    # Today stats
    cursor.execute('''
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN violation_type = 'eat_in_hand' THEN 1 ELSE 0 END) as hand_count,
            SUM(CASE WHEN violation_type = 'waste_food' THEN 1 ELSE 0 END) as waste_count,
            SUM(CASE WHEN violation_type = 'both' THEN 1 ELSE 0 END) as both_count,
            COUNT(DISTINCT student_id) as unique_students
        FROM food_logs
        WHERE log_date = ?
    ''', (today_str,))
    today_stats = dict(cursor.fetchone() or {})

    # All-time stats
    cursor.execute('''
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN violation_type = 'eat_in_hand' THEN 1 ELSE 0 END) as hand_count,
            SUM(CASE WHEN violation_type = 'waste_food' THEN 1 ELSE 0 END) as waste_count,
            SUM(CASE WHEN violation_type = 'both' THEN 1 ELSE 0 END) as both_count,
            COUNT(DISTINCT student_id) as unique_students
        FROM food_logs
    ''')
    all_time_stats = dict(cursor.fetchone() or {})

    # Meal distribution
    cursor.execute('''
        SELECT meal_session, COUNT(*) as count 
        FROM food_logs 
        GROUP BY meal_session 
        ORDER BY count DESC
    ''')
    meal_distribution = [dict(r) for r in cursor.fetchall()]

    # Repeat Offenders Leaderboard
    cursor.execute('''
        SELECT 
            s.id, s.roll_no, s.name, s.batch,
            COUNT(l.id) as total_violations,
            SUM(CASE WHEN l.violation_type IN ('eat_in_hand', 'both') THEN 1 ELSE 0 END) as hand_violations,
            SUM(CASE WHEN l.violation_type IN ('waste_food', 'both') THEN 1 ELSE 0 END) as waste_violations,
            MAX(l.log_date) as last_violation_date
        FROM students s
        JOIN food_logs l ON s.id = l.student_id
        GROUP BY s.id
        ORDER BY total_violations DESC, s.name ASC
        LIMIT 15
    ''')
    leaderboard = [dict(r) for r in cursor.fetchall()]

    # Last 14 days trend
    trend_start = (date.today() - timedelta(days=13)).isoformat()
    cursor.execute('''
        SELECT 
            log_date,
            SUM(CASE WHEN violation_type IN ('eat_in_hand', 'both') THEN 1 ELSE 0 END) as hand_count,
            SUM(CASE WHEN violation_type IN ('waste_food', 'both') THEN 1 ELSE 0 END) as waste_count,
            COUNT(*) as total
        FROM food_logs
        WHERE log_date >= ?
        GROUP BY log_date
        ORDER BY log_date ASC
    ''', (trend_start,))
    daily_trends = [dict(r) for r in cursor.fetchall()]

    conn.close()

    return jsonify({
        'today': today_stats,
        'all_time': all_time_stats,
        'meal_distribution': meal_distribution,
        'leaderboard': leaderboard,
        'daily_trends': daily_trends
    })

@app.route('/api/upload-excel', methods=['POST'])
def api_upload_excel():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    batch_name = request.form.get('batch_name', 'II MBA').strip()
    action = request.form.get('action', 'import')  # 'preview' or 'import'

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{filename}")
    file.save(filepath)

    try:
        if action == 'preview':
            preview = preview_excel_file(filepath)
            return jsonify({'success': True, 'preview': preview})
        else:
            result = import_students_from_excel(filepath, default_batch=batch_name)
            return jsonify({
                'success': True,
                'batch_name': batch_name,
                'imported': result['imported'],
                'updated': result['updated'],
                'skipped': result['skipped'],
                'errors': result['errors']
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/export/excel')
def export_excel():
    conn = get_db_connection()
    cursor = conn.cursor()

    req_date = request.args.get('date', '')
    start_date = request.args.get('start_date', '')
    end_date = request.args.get('end_date', '')
    meal = request.args.get('meal_session', '')
    violation = request.args.get('violation_type', '')
    batch = request.args.get('batch', '')
    search = request.args.get('search', '')

    query = '''
        SELECT l.*, s.roll_no, s.name as student_name, s.batch, s.gender, s.mobile
        FROM food_logs l
        JOIN students s ON l.student_id = s.id
        WHERE 1=1
    '''
    params = []

    if start_date and end_date:
        query += ' AND l.log_date BETWEEN ? AND ?'
        params.extend([start_date, end_date])
    elif req_date:
        query += ' AND l.log_date = ?'
        params.append(req_date)

    if meal and meal != 'All':
        query += ' AND l.meal_session = ?'
        params.append(meal)

    if violation and violation != 'All':
        query += ' AND l.violation_type = ?'
        params.append(violation)

    if batch and batch != 'All':
        query += ' AND s.batch = ?'
        params.append(batch)

    if search:
        query += ' AND (s.roll_no LIKE ? OR s.name LIKE ? OR l.remarks LIKE ?)'
        like_str = f'%{search}%'
        params.extend([like_str, like_str, like_str])

    query += ' ORDER BY l.log_date DESC, l.id DESC'

    cursor.execute(query, params)
    logs = [dict(r) for r in cursor.fetchall()]
    conn.close()

    # Generate styled Excel workbook
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Magis Cafe Food Logs"

    # Title Block
    ws.merge_cells('A1:I1')
    ws['A1'] = "JIM - MAGIS CAFE FOOD COMMITTEE MONITORING RECORD"
    ws['A1'].font = Font(name='Segoe UI', size=14, bold=True, color='FFFFFF')
    ws['A1'].fill = PatternFill(start_color='1E3A8A', end_color='1E3A8A', fill_type='solid')
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[1].height = 36

    ws.merge_cells('A2:I2')
    sub_title = f"Generated on: {datetime.now().strftime('%d %B %Y, %I:%M %p')} | Total Records: {len(logs)}"
    ws['A2'] = sub_title
    ws['A2'].font = Font(name='Segoe UI', size=10, italic=True, color='475569')
    ws['A2'].alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[2].height = 20

    # Headers
    headers = [
        "S.No", "Date", "Meal Session", "Roll Number", 
        "Student Name", "Batch", "Violation Type", "Waste Severity", "Remarks"
    ]
    header_fill = PatternFill(start_color='3B82F6', end_color='3B82F6', fill_type='solid')
    header_font = Font(name='Segoe UI', size=11, bold=True, color='FFFFFF')
    border_thin = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    for col_idx, h in enumerate(headers, start=1):
        cell = ws.cell(row=4, column=col_idx, value=h)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal='center', vertical='center')
        cell.border = border_thin
    ws.row_dimensions[4].height = 26

    # Data Rows
    row_alt_fill = PatternFill(start_color='F8FAFC', end_color='F8FAFC', fill_type='solid')
    violation_labels = {
        'eat_in_hand': 'Eat in Hand',
        'waste_food': 'Wasted Food',
        'both': 'Both (Hand + Waste)'
    }

    for idx, l in enumerate(logs, start=1):
        current_row = idx + 4
        v_label = violation_labels.get(l['violation_type'], l['violation_type'])
        
        row_values = [
            idx,
            l['log_date'],
            l['meal_session'],
            l['roll_no'],
            l['student_name'],
            l['batch'],
            v_label,
            l['waste_severity'] or 'Normal',
            l['remarks'] or '-'
        ]

        for col_idx, val in enumerate(row_values, start=1):
            cell = ws.cell(row=current_row, column=col_idx, value=val)
            cell.font = Font(name='Segoe UI', size=10)
            cell.border = border_thin
            if idx % 2 == 0:
                cell.fill = row_alt_fill
            
            # Alignments
            if col_idx in [1, 2, 3, 4, 6, 8]:
                cell.alignment = Alignment(horizontal='center', vertical='center')
            else:
                cell.alignment = Alignment(horizontal='left', vertical='center')

        ws.row_dimensions[current_row].height = 22

    # Column Widths
    col_widths = [8, 14, 15, 16, 30, 12, 22, 16, 32]
    for i, w in enumerate(col_widths, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Magis_Cafe_Logs_{date.today().strftime('%Y%m%d')}.xlsx"
    return send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("=" * 60)
    print("  JIM - MAGIS CAFE FOOD COMMITTEE MONITORING SYSTEM")
    print("=" * 60)
    print(f" * Local PC Access:    http://127.0.0.1:5000")
    print(f" * Mobile Phone Access: http://{local_ip}:5000")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=True)
