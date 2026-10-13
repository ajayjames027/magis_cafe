import sys
import os

# Add parent directory to sys.path so app and db_service can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

class VercelPathMiddleware:
    """
    WSGI Middleware for Vercel Serverless Python.
    When Vercel rewrites requests to /api/index, PATH_INFO is set to
    /api/index instead of the user's actual requested path.
    This middleware restores the original requested path from REQUEST_URI
    or HTTP_X_NOW_PATHNAME so Flask's URL routing works accurately.
    """
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        raw_path = (
            environ.get('HTTP_X_NOW_PATHNAME') or
            environ.get('HTTP_X_FORWARDED_PATH') or
            environ.get('REQUEST_URI') or
            environ.get('RAW_URI') or
            ''
        )
        if raw_path:
            clean_path = raw_path.split('?')[0]
            if clean_path and clean_path not in ('/api/index', '/api/index.py'):
                environ['PATH_INFO'] = clean_path
            elif clean_path in ('/api/index', '/api/index.py') and environ.get('PATH_INFO') in ('/api/index', '/api/index.py'):
                environ['PATH_INFO'] = '/'
        elif environ.get('PATH_INFO') in ('/api/index', '/api/index.py'):
            environ['PATH_INFO'] = '/'

        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)
