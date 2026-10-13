import sys
import os

# Add parent directory to sys.path so app and db_service can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

# Vercel expects the Flask app instance
app = app
