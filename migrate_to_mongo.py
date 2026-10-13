import sys
import os
import sqlite3
from pymongo import MongoClient

def migrate(mongo_uri):
    print(f"Connecting to MongoDB...")
    client = MongoClient(mongo_uri)
    db = client.get_default_database() or client['magis_cafe']

    sqlite_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'magis_cafe.db')
    if not os.path.exists(sqlite_path):
        print(f"Error: {sqlite_path} not found.")
        return

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # 1. Migrate Students
    c.execute('SELECT * FROM students')
    students = [dict(r) for r in c.fetchall()]
    print(f"Found {len(students)} students in SQLite.")
    
    st_count = 0
    for s in students:
        db.students.update_one(
            {'roll_no': s['roll_no']},
            {
                '$set': {
                    'name': s['name'],
                    'batch': s['batch'],
                    'mobile': s['mobile'],
                    'gender': s['gender'],
                    'is_active': s['is_active'],
                    'created_at': s['created_at']
                }
            },
            upsert=True
        )
        st_count += 1
    print(f"Successfully migrated {st_count} students to MongoDB.")

    # 2. Migrate Food Logs
    c.execute('''
        SELECT l.*, s.roll_no, s.name as student_name, s.batch, s.gender, s.mobile
        FROM food_logs l
        JOIN students s ON l.student_id = s.id
    ''')
    logs = [dict(r) for r in c.fetchall()]
    print(f"Found {len(logs)} logs in SQLite.")

    log_count = 0
    for l in logs:
        st_doc = db.students.find_one({'roll_no': l['roll_no']})
        doc = {
            'student_id': str(st_doc['_id']) if st_doc else str(l['student_id']),
            'roll_no': l['roll_no'],
            'student_name': l['student_name'],
            'batch': l['batch'],
            'gender': l.get('gender', ''),
            'mobile': l.get('mobile', ''),
            'log_date': l['log_date'],
            'meal_session': l['meal_session'],
            'violation_type': l['violation_type'],
            'waste_severity': l['waste_severity'],
            'remarks': l['remarks'],
            'logged_by': l['logged_by'],
            'created_at': l['created_at']
        }
        db.food_logs.insert_one(doc)
        log_count += 1
    print(f"Successfully migrated {log_count} food logs to MongoDB.")
    
    # Create indexes
    db.students.create_index('roll_no', unique=True)
    db.students.create_index('batch')
    db.food_logs.create_index('log_date')
    db.food_logs.create_index('meal_session')
    db.food_logs.create_index('violation_type')
    db.food_logs.create_index('roll_no')

    conn.close()
    print("Migration to MongoDB completed successfully!")

if __name__ == '__main__':
    uri = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MONGO_URI')
    if not uri:
        print("Usage: python migrate_to_mongo.py '<YOUR_MONGO_URI>'")
        print("Or set MONGO_URI in your environment.")
        sys.exit(1)
    migrate(uri)
