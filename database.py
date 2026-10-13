import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'magis_cafe.db')

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Students table
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

    # Food logs table
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

    # Indexes for fast querying and filtering
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_no)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_students_batch ON students(batch)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_date ON food_logs(log_date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_student ON food_logs(student_id)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_meal ON food_logs(meal_session)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_logs_violation ON food_logs(violation_type)')

    conn.commit()
    conn.close()

def seed_initial_students_if_empty():
    """Seed I MBA students from Excel if students table is empty."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT COUNT(*) FROM students')
    count = cursor.fetchone()[0]
    conn.close()

    if count == 0:
        excel_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'I_MBA_Students Data -110.xlsx')
        if os.path.exists(excel_path):
            from importer import import_students_from_excel
            print(f"Loading initial students from {excel_path}...")
            result = import_students_from_excel(excel_path, default_batch='I MBA')
            print(f"Loaded {result['imported']} students successfully.")

if __name__ == '__main__':
    init_db()
    seed_initial_students_if_empty()
    print("Database initialized successfully.")
