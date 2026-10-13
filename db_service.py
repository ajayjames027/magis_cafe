import os
import sqlite3
from datetime import datetime, date, timedelta
import re

MONGO_URI = os.environ.get('MONGO_URI', '').strip()
DB_TYPE = 'mongo' if MONGO_URI else 'sqlite'
SQLITE_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'magis_cafe.db')

mongo_client = None
mongo_db = None

if MONGO_URI:
    try:
        from pymongo import MongoClient
        mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        # Parse db name or default to magis_cafe
        db_name = 'magis_cafe'
        try:
            default_db = mongo_client.get_default_database()
            if default_db is not None:
                db_name = default_db.name
        except Exception:
            pass
        mongo_db = mongo_client[db_name]
        # Test connection
        mongo_client.admin.command('ping')
        print(f"Connected to MongoDB Atlas successfully (DB: {db_name}).")
        DB_TYPE = 'mongo'
    except Exception as e:
        print(f"Failed to connect to MongoDB ({e}). Falling back to SQLite.")
        DB_TYPE = 'sqlite'
        mongo_client = None
        mongo_db = None

def get_sqlite_conn():
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    if DB_TYPE == 'mongo' and mongo_db is not None:
        # Create indexes in Mongo
        mongo_db.students.create_index('roll_no', unique=True)
        mongo_db.students.create_index('batch')
        mongo_db.food_logs.create_index('log_date')
        mongo_db.food_logs.create_index('meal_session')
        mongo_db.food_logs.create_index('violation_type')
        mongo_db.food_logs.create_index('roll_no')
        seed_students_if_empty()
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                roll_no TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                batch TEXT NOT NULL DEFAULT 'I MBA',
                mobile TEXT,
                gender TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS food_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL,
                log_date TEXT NOT NULL,
                meal_session TEXT NOT NULL,
                violation_type TEXT NOT NULL,
                waste_severity TEXT DEFAULT 'Normal',
                remarks TEXT,
                logged_by TEXT DEFAULT 'Food Committee',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE
            )
        ''')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_no)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_date ON food_logs(log_date)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_student ON food_logs(student_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_meal ON food_logs(meal_session)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_violation ON food_logs(violation_type)')
        conn.commit()
        conn.close()
        seed_students_if_empty()

def seed_students_if_empty():
    count = 0
    if DB_TYPE == 'mongo' and mongo_db is not None:
        count = mongo_db.students.count_documents({})
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM students')
        count = cursor.fetchone()[0]
        conn.close()

    if count == 0:
        excel_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'I_MBA_Students Data -110.xlsx')
        if os.path.exists(excel_path):
            import openpyxl
            wb = openpyxl.load_workbook(excel_path, data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(values_only=True))
            students_to_add = []
            for r in rows[1:]:
                if len(r) > 2 and r[1] and r[2]:
                    roll = str(r[1]).strip().upper()
                    name = str(r[2]).strip().upper()
                    mobile = str(r[3]).strip() if len(r) > 3 and r[3] else ''
                    if mobile.endswith('.0'): mobile = mobile[:-2]
                    gender = str(r[4]).strip().upper() if len(r) > 4 and r[4] else ''
                    if gender: gender = gender[0]
                    students_to_add.append({
                        'roll_no': roll,
                        'name': name,
                        'batch': 'I MBA',
                        'mobile': mobile,
                        'gender': gender
                    })
            for s in students_to_add:
                create_or_update_student(s['roll_no'], s['name'], s['batch'], s['mobile'], s['gender'])
            print(f"Seeded {len(students_to_add)} students into {DB_TYPE.upper()}.")

def get_batches():
    if DB_TYPE == 'mongo' and mongo_db is not None:
        pipeline = [
            {'$match': {'is_active': {'$ne': 0}}},
            {'$group': {'_id': '$batch', 'count': {'$sum': 1}}},
            {'$sort': {'_id': 1}}
        ]
        res = list(mongo_db.students.aggregate(pipeline))
        return [{'batch': r['_id'], 'count': r['count']} for r in res]
    else:
        conn = get_sqlite_conn()
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
        return batches

def get_students(search='', batch='', log_date='', meal_session=''):
    if DB_TYPE == 'mongo' and mongo_db is not None:
        query = {'is_active': {'$ne': 0}}
        if batch and batch != 'All':
            query['batch'] = batch
        if search:
            regex = re.compile(re.escape(search), re.IGNORECASE)
            query['$or'] = [
                {'roll_no': {'$regex': regex}},
                {'name': {'$regex': regex}},
                {'mobile': {'$regex': regex}}
            ]
        cursor = mongo_db.students.find(query).sort('roll_no', 1)
        students = []
        for doc in cursor:
            st_id = str(doc['_id'])
            roll = doc.get('roll_no', '')
            
            # Count today's logs for this student
            today_count = 0
            current_meal_violation = None
            if log_date:
                today_count = mongo_db.food_logs.count_documents({
                    'roll_no': roll,
                    'log_date': log_date
                })
                meal_query = {'roll_no': roll, 'log_date': log_date}
                if meal_session:
                    meal_query['meal_session'] = meal_session
                last_log = mongo_db.food_logs.find_one(meal_query, sort=[('_id', -1)])
                if last_log:
                    current_meal_violation = last_log.get('violation_type')

            students.append({
                'id': st_id,
                'roll_no': roll,
                'name': doc.get('name', ''),
                'batch': doc.get('batch', 'I MBA'),
                'mobile': doc.get('mobile', ''),
                'gender': doc.get('gender', ''),
                'today_logs_count': today_count,
                'current_meal_violation': current_meal_violation
            })
        return students
    else:
        conn = get_sqlite_conn()
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
        return students

def create_or_update_student(roll_no, name, batch='I MBA', mobile='', gender='M'):
    roll_no = str(roll_no).strip().upper()
    name = str(name).strip().upper()
    batch = str(batch).strip()
    mobile = str(mobile).strip()
    gender = str(gender).strip().upper()
    if gender: gender = gender[0]

    if DB_TYPE == 'mongo' and mongo_db is not None:
        mongo_db.students.update_one(
            {'roll_no': roll_no},
            {
                '$set': {
                    'name': name,
                    'batch': batch,
                    'mobile': mobile,
                    'gender': gender,
                    'is_active': 1,
                    'updated_at': datetime.now().isoformat()
                },
                '$setOnInsert': {
                    'created_at': datetime.now().isoformat()
                }
            },
            upsert=True
        )
        return True
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM students WHERE roll_no = ?', (roll_no,))
        row = cursor.fetchone()
        if row:
            cursor.execute('''
                UPDATE students SET name = ?, batch = ?, mobile = ?, gender = ? WHERE id = ?
            ''', (name, batch, mobile, gender, row['id']))
        else:
            cursor.execute('''
                INSERT INTO students (roll_no, name, batch, mobile, gender) VALUES (?, ?, ?, ?, ?)
            ''', (roll_no, name, batch, mobile, gender))
        conn.commit()
        conn.close()
        return True

def delete_student(student_id):
    if DB_TYPE == 'mongo' and mongo_db is not None:
        from bson import ObjectId
        try:
            mongo_db.students.delete_one({'_id': ObjectId(student_id)})
        except Exception:
            mongo_db.students.delete_one({'roll_no': str(student_id)})
        return True
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM students WHERE id = ?', (student_id,))
        conn.commit()
        conn.close()
        return True

def create_food_logs(student_ids, log_date, meal_session, violation_type, waste_severity='Normal', remarks='', logged_by='Food Committee'):
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    created_ids = []
    recorded_names = []

    if DB_TYPE == 'mongo' and mongo_db is not None:
        from bson import ObjectId
        for sid in student_ids:
            # find student
            student = None
            try:
                student = mongo_db.students.find_one({'_id': ObjectId(sid)})
            except Exception:
                pass
            if not student:
                student = mongo_db.students.find_one({'roll_no': str(sid)})

            if student:
                doc = {
                    'student_id': str(student['_id']),
                    'roll_no': student['roll_no'],
                    'student_name': student['name'],
                    'batch': student['batch'],
                    'gender': student.get('gender', ''),
                    'mobile': student.get('mobile', ''),
                    'log_date': log_date,
                    'meal_session': meal_session,
                    'violation_type': violation_type,
                    'waste_severity': waste_severity,
                    'remarks': remarks,
                    'logged_by': logged_by,
                    'created_at': now_str
                }
                res = mongo_db.food_logs.insert_one(doc)
                created_ids.append(str(res.inserted_id))
                recorded_names.append(f"{student['roll_no']} ({student['name']})")
        return created_ids, recorded_names
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        for sid in student_ids:
            cursor.execute('''
                INSERT INTO food_logs (student_id, log_date, meal_session, violation_type, waste_severity, remarks, logged_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (sid, log_date, meal_session, violation_type, waste_severity, remarks, logged_by, now_str))
            created_ids.append(cursor.lastrowid)

            cursor.execute('SELECT roll_no, name FROM students WHERE id = ?', (sid,))
            st = cursor.fetchone()
            if st:
                recorded_names.append(f"{st['roll_no']} ({st['name']})")
        conn.commit()
        conn.close()
        return created_ids, recorded_names

def get_food_logs(date='', start_date='', end_date='', meal_session='', violation_type='', batch='', search='', limit=300):
    if DB_TYPE == 'mongo' and mongo_db is not None:
        query = {}
        if start_date and end_date:
            query['log_date'] = {'$gte': start_date, '$lte': end_date}
        elif date:
            query['log_date'] = date

        if meal_session and meal_session != 'All':
            query['meal_session'] = meal_session

        if violation_type and violation_type != 'All':
            query['violation_type'] = violation_type

        if batch and batch != 'All':
            query['batch'] = batch

        if search:
            regex = re.compile(re.escape(search), re.IGNORECASE)
            query['$or'] = [
                {'roll_no': {'$regex': regex}},
                {'student_name': {'$regex': regex}},
                {'remarks': {'$regex': regex}}
            ]

        cursor = mongo_db.food_logs.find(query).sort([('log_date', -1), ('_id', -1)]).limit(limit)
        logs = []
        for doc in cursor:
            doc['id'] = str(doc['_id'])
            logs.append(doc)

        total_logs = len(logs)
        eat_in_hand_count = sum(1 for l in logs if l['violation_type'] == 'eat_in_hand')
        waste_food_count = sum(1 for l in logs if l['violation_type'] == 'waste_food')
        both_count = sum(1 for l in logs if l['violation_type'] == 'both')
        unique_students_count = len(set(l.get('roll_no') for l in logs))

        return logs, {
            'total': total_logs,
            'eat_in_hand': eat_in_hand_count,
            'waste_food': waste_food_count,
            'both': both_count,
            'unique_students': unique_students_count
        }
    else:
        conn = get_sqlite_conn()
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
        elif date:
            query += ' AND l.log_date = ?'
            params.append(date)

        if meal_session and meal_session != 'All':
            query += ' AND l.meal_session = ?'
            params.append(meal_session)

        if violation_type and violation_type != 'All':
            query += ' AND l.violation_type = ?'
            params.append(violation_type)

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

        total_logs = len(logs)
        eat_in_hand_count = sum(1 for l in logs if l['violation_type'] == 'eat_in_hand')
        waste_food_count = sum(1 for l in logs if l['violation_type'] == 'waste_food')
        both_count = sum(1 for l in logs if l['violation_type'] == 'both')
        unique_students_count = len(set(l['student_id'] for l in logs))

        conn.close()
        return logs, {
            'total': total_logs,
            'eat_in_hand': eat_in_hand_count,
            'waste_food': waste_food_count,
            'both': both_count,
            'unique_students': unique_students_count
        }

def delete_food_log(log_id):
    if DB_TYPE == 'mongo' and mongo_db is not None:
        from bson import ObjectId
        try:
            mongo_db.food_logs.delete_one({'_id': ObjectId(log_id)})
        except Exception:
            mongo_db.food_logs.delete_one({'id': log_id})
        return True
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM food_logs WHERE id = ?', (log_id,))
        conn.commit()
        conn.close()
        return True

def get_analytics_data():
    today_str = date.today().isoformat()
    trend_start = (date.today() - timedelta(days=13)).isoformat()

    if DB_TYPE == 'mongo' and mongo_db is not None:
        # Today stats
        today_logs = list(mongo_db.food_logs.find({'log_date': today_str}))
        today_stats = {
            'total': len(today_logs),
            'hand_count': sum(1 for l in today_logs if l.get('violation_type') == 'eat_in_hand'),
            'waste_count': sum(1 for l in today_logs if l.get('violation_type') == 'waste_food'),
            'both_count': sum(1 for l in today_logs if l.get('violation_type') == 'both'),
            'unique_students': len(set(l.get('roll_no') for l in today_logs))
        }

        # All-time stats
        all_logs = list(mongo_db.food_logs.find({}))
        all_time_stats = {
            'total': len(all_logs),
            'hand_count': sum(1 for l in all_logs if l.get('violation_type') == 'eat_in_hand'),
            'waste_count': sum(1 for l in all_logs if l.get('violation_type') == 'waste_food'),
            'both_count': sum(1 for l in all_logs if l.get('violation_type') == 'both'),
            'unique_students': len(set(l.get('roll_no') for l in all_logs))
        }

        # Meal distribution
        meal_agg = list(mongo_db.food_logs.aggregate([
            {'$group': {'_id': '$meal_session', 'count': {'$sum': 1}}},
            {'$sort': {'count': -1}}
        ]))
        meal_distribution = [{'meal_session': m['_id'], 'count': m['count']} for m in meal_agg]

        # Leaderboard
        board_agg = list(mongo_db.food_logs.aggregate([
            {
                '$group': {
                    '_id': '$roll_no',
                    'name': {'$first': '$student_name'},
                    'batch': {'$first': '$batch'},
                    'total_violations': {'$sum': 1},
                    'hand_violations': {
                        '$sum': {'$cond': [{'$in': ['$violation_type', ['eat_in_hand', 'both']]}, 1, 0]}
                    },
                    'waste_violations': {
                        '$sum': {'$cond': [{'$in': ['$violation_type', ['waste_food', 'both']]}, 1, 0]}
                    },
                    'last_violation_date': {'$max': '$log_date'}
                }
            },
            {'$sort': {'total_violations': -1, 'name': 1}},
            {'$limit': 15}
        ]))
        leaderboard = [{
            'id': b['_id'],
            'roll_no': b['_id'],
            'name': b['name'],
            'batch': b['batch'],
            'total_violations': b['total_violations'],
            'hand_violations': b['hand_violations'],
            'waste_violations': b['waste_violations'],
            'last_violation_date': b['last_violation_date']
        } for b in board_agg]

        # Daily trends
        trend_agg = list(mongo_db.food_logs.aggregate([
            {'$match': {'log_date': {'$gte': trend_start}}},
            {
                '$group': {
                    '_id': '$log_date',
                    'hand_count': {
                        '$sum': {'$cond': [{'$in': ['$violation_type', ['eat_in_hand', 'both']]}, 1, 0]}
                    },
                    'waste_count': {
                        '$sum': {'$cond': [{'$in': ['$violation_type', ['waste_food', 'both']]}, 1, 0]}
                    },
                    'total': {'$sum': 1}
                }
            },
            {'$sort': {'_id': 1}}
        ]))
        daily_trends = [{
            'log_date': t['_id'],
            'hand_count': t['hand_count'],
            'waste_count': t['waste_count'],
            'total': t['total']
        } for t in trend_agg]

        return {
            'db_type': 'MongoDB Atlas' if 'mongodb+srv' in MONGO_URI else 'MongoDB Local',
            'today': today_stats,
            'all_time': all_time_stats,
            'meal_distribution': meal_distribution,
            'leaderboard': leaderboard,
            'daily_trends': daily_trends
        }
    else:
        conn = get_sqlite_conn()
        cursor = conn.cursor()
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

        cursor.execute('''
            SELECT meal_session, COUNT(*) as count 
            FROM food_logs 
            GROUP BY meal_session 
            ORDER BY count DESC
        ''')
        meal_distribution = [dict(r) for r in cursor.fetchall()]

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

        return {
            'db_type': 'SQLite (Local)',
            'today': today_stats,
            'all_time': all_time_stats,
            'meal_distribution': meal_distribution,
            'leaderboard': leaderboard,
            'daily_trends': daily_trends
        }
