import os
import sys
import time
import threading
import webbrowser
from app import app, get_local_ip

def open_browser():
    time.sleep(1.2)
    webbrowser.open('http://127.0.0.1:5000')

if __name__ == '__main__':
    local_ip = get_local_ip()
    port = 5000
    
    print("\n" + "=" * 65)
    print("  🍛 JIM - MAGIS CAFE FOOD COMMITTEE MONITORING SYSTEM ☕")
    print("=" * 65)
    print(f"  * Local Access:     http://127.0.0.1:{port}")
    print(f"  * Mobile Phone:     http://{local_ip}:{port}")
    print("=" * 65)
    print("  * Food Committee members on campus Wi-Fi can open the")
    print("    Mobile Phone link or scan the QR code in the app.")
    print("=" * 65 + "\n")

    threading.Thread(target=open_browser, daemon=True).start()
    app.run(host='0.0.0.0', port=port, debug=False)
