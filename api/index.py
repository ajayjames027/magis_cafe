import sys
import os
import urllib.parse

# Add parent directory to sys.path so app and db_service can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app

class VercelPathMiddleware:
    """
    WSGI Middleware for Vercel Serverless Python.
    Vercel rewrites incoming requests to /api/index with __v_path=/$1.
    This middleware extracts __v_path and sets PATH_INFO cleanly,
    stripping __v_path from QUERY_STRING so Flask sees pristine query params.
    """
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        query_string = environ.get('QUERY_STRING', '')
        if '__v_path=' in query_string:
            params = urllib.parse.parse_qs(query_string, keep_blank_values=True)
            v_path = params.pop('__v_path', [None])[0]
            if v_path:
                clean_path = v_path if v_path.startswith('/') else '/' + v_path
                environ['PATH_INFO'] = clean_path.split('?')[0]
            new_qs = urllib.parse.urlencode(params, doseq=True)
            environ['QUERY_STRING'] = new_qs
        elif environ.get('PATH_INFO') in ('/api/index', '/api/index.py', ''):
            raw_path = (
                environ.get('HTTP_X_NOW_PATHNAME') or
                environ.get('HTTP_X_FORWARDED_PATH') or
                environ.get('REQUEST_URI') or
                ''
            )
            if raw_path and raw_path not in ('/api/index', '/api/index.py'):
                environ['PATH_INFO'] = raw_path.split('?')[0]
            else:
                environ['PATH_INFO'] = '/'

        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)

