import os
import json
import urllib.parse
import urllib.request
import urllib.error
from http.server import SimpleHTTPRequestHandler, HTTPServer
from http.cookies import SimpleCookie

PORT = int(os.environ.get("PORT", 8000))
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin888")

# Gemini API 配置
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-1.5-flash")

class SecureInvoiceHandler(SimpleHTTPRequestHandler):
    def get_cookie_auth(self):
        cookie_header = self.headers.get('Cookie')
        if cookie_header:
            cookie = SimpleCookie()
            cookie.load(cookie_header)
            if 'authenticated' in cookie:
                return cookie['authenticated'].value == 'true'
        return False

    def do_GET(self):
        # 規整化路徑 (去除 query string 和 hash)
        url_parts = urllib.parse.urlparse(self.path)
        clean_path = url_parts.path

        if clean_path == '/api/config':
            if not self.get_cookie_auth():
                self.send_response(401)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "未授權"}).encode('utf-8'))
                return
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            response = {
                "serverHasKey": bool(GEMINI_API_KEY),
                "defaultModel": GEMINI_MODEL
            }
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return

        # 允許匿名讀取的靜態資源與路徑
        anonymous_paths = ['/login', '/login.html', '/style.css']

        if clean_path == '/' or clean_path == '/index.html':
            if not self.get_cookie_auth():
                self.send_response(302)
                self.send_header('Location', '/login')
                self.end_headers()
                return
        elif clean_path == '/login':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            try:
                with open(os.path.join(os.getcwd(), 'login.html'), 'rb') as f:
                    self.wfile.write(f.read())
            except Exception as e:
                self.wfile.write(f"Error loading login page: {str(e)}".encode('utf-8'))
            return
        elif clean_path not in anonymous_paths:
            # 保護其他靜態檔案 (例如 app.js)
            if not self.get_cookie_auth():
                self.send_response(302)
                self.send_header('Location', '/login')
                self.end_headers()
                return

        return super().do_GET()

    def do_POST(self):
        url_parts = urllib.parse.urlparse(self.path)
        clean_path = url_parts.path

        if clean_path == '/api/login':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length).decode('utf-8')
            
            try:
                # 嘗試解析為 JSON
                data = json.loads(post_data)
                username = data.get('username')
                password = data.get('password')
            except json.JSONDecodeError:
                # 嘗試解析為 urlencoded
                params = urllib.parse.parse_qs(post_data)
                username = params.get('username', [None])[0]
                password = params.get('password', [None])[0]

            if username == ADMIN_USER and password == ADMIN_PASSWORD:
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                # 設定 Cookie
                self.send_header('Set-Cookie', 'authenticated=true; Path=/; Max-Age=86400')
                self.end_headers()
                response = {"success": True, "message": "登入成功"}
                self.wfile.write(json.dumps(response).encode('utf-8'))
            else:
                self.send_response(401)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                response = {"success": False, "message": "帳號或密碼錯誤！"}
                self.wfile.write(json.dumps(response).encode('utf-8'))
            return
            
        elif clean_path == '/api/logout':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            # 銷毀 Cookie
            self.send_header('Set-Cookie', 'authenticated=; Path=/; Max-Age=0')
            self.end_headers()
            response = {"success": True, "redirect": "/login"}
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return

        elif clean_path == '/api/gemini':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            if not self.get_cookie_auth():
                self.send_response(401)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "message": "未授權"}).encode('utf-8'))
                return
            
            try:
                req_data = json.loads(body.decode('utf-8'))
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": f"無效的 JSON 內容: {str(e)}"}}).encode('utf-8'))
                return

            model = req_data.get('model', GEMINI_MODEL)
            
            if not GEMINI_API_KEY:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": "伺服器未設定 GEMINI_API_KEY 環境變數。"}}).encode('utf-8'))
                return
                
            # 準備轉發給 Google Gemini API
            # 移除 model 欄位，因為 payload 本身可能不需要 model 欄位 (原本打 Google API 時，model 是在 URL 中)
            if 'model' in req_data:
                del req_data['model']
                
            google_url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
            google_payload = json.dumps(req_data).encode('utf-8')
            
            try:
                google_req = urllib.request.Request(
                    google_url,
                    data=google_payload,
                    headers={'Content-Type': 'application/json'},
                    method='POST'
                )
                with urllib.request.urlopen(google_req, timeout=30) as resp:
                    result = resp.read()
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(result)
            except urllib.error.HTTPError as e:
                err_body = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(err_body)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({"error": {"message": f"代理請求失敗: {str(e)}"}}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run(server_class=HTTPServer, handler_class=SecureInvoiceHandler):
    server_address = ('', PORT)
    httpd = server_class(server_address, handler_class)
    print(f"Python 本地安全開發伺服器正在運行於 http://localhost:{PORT}")
    print(f"預設登入帳號: {ADMIN_USER}，密碼: {ADMIN_PASSWORD}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    httpd.server_close()

if __name__ == '__main__':
    run()
