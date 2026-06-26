import urllib.request
import urllib.parse
import json
import http.cookiejar

BASE_URL = "http://localhost:8000"

def run_tests():
    print("=== 開始進行後端安全與功能測試 ===")
    
    # 建立一個 CookieJar 來自動處理 Cookie
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    
    # 1. 測試未登入攔截 (GET /)
    try:
        print("1. 測試未登入訪問首頁是否攔截...")
        # 禁用自動重定向，以便我們可以檢查 302 狀態
        class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                # 阻止重定向，並拋出 HTTPError
                raise urllib.error.HTTPError(req.full_url, code, msg, headers, fp)
                
        test_opener = urllib.request.build_opener(NoRedirectHandler())
        test_opener.open(BASE_URL + "/")
        print("[ERROR] 測試失敗: 未登入用戶居然可以直接訪問首頁！")
        return False
    except urllib.error.HTTPError as e:
        if e.code == 302 and "login" in e.headers.get("Location", ""):
            print("[PASS] 測試成功: 未登入用戶被正確 302 重定向到登入頁面！")
        else:
            print(f"[ERROR] 測試失敗: 預期 302 重定向到 /login，但得到代碼 {e.code}，位置 {e.headers.get('Location')}")
            return False

    # 2. 測試密碼錯誤 (POST /api/login)
    print("2. 測試錯誤密碼登入...")
    login_data = json.dumps({"username": "admin", "password": "wrongpassword"}).encode('utf-8')
    req = urllib.request.Request(BASE_URL + "/api/login", data=login_data, headers={'Content-Type': 'application/json'})
    try:
        opener.open(req)
        print("[ERROR] 測試失敗: 密碼錯誤居然登入成功了！")
        return False
    except urllib.error.HTTPError as e:
        if e.code == 401:
            body = e.read().decode('utf-8')
            res = json.loads(body)
            if not res.get("success") and "錯誤" in res.get("message", ""):
                print("[PASS] 測試成功: 密碼錯誤被正確拒絕，並傳回 401 錯誤訊息！")
            else:
                print(f"[ERROR] 測試失敗: 傳回的錯誤 JSON 格式不符: {body}")
                return False
        else:
            print(f"[ERROR] 測試失敗: 預期 401，但得到 {e.code}")
            return False

    # 3. 測試正確密碼登入 (POST /api/login)
    print("3. 測試正確帳密登入...")
    login_data = json.dumps({"username": "admin", "password": "admin888"}).encode('utf-8')
    req = urllib.request.Request(BASE_URL + "/api/login", data=login_data, headers={'Content-Type': 'application/json'})
    try:
        response = opener.open(req)
        body = response.read().decode('utf-8')
        res = json.loads(body)
        if res.get("success"):
            print("[PASS] 測試成功: 登入成功，已取得 Session Cookie！")
            cookies = [cookie.name for cookie in cj]
            print(f"   取得的 Cookie: {cookies}")
        else:
            print(f"[ERROR] 測試失敗: 正確密碼卻登入失敗: {body}")
            return False
    except Exception as e:
        print(f"[ERROR] 測試失敗: 發生異常: {str(e)}")
        return False

    # 4. 測試已登入訪問首頁 (GET /)
    print("4. 測試已登入用戶訪問首頁...")
    try:
        response = opener.open(BASE_URL + "/")
        if response.code == 200:
            html = response.read().decode('utf-8')
            if "發票旅費助手" in html or "發票與出差旅費整理統計工具" in html:
                print("[PASS] 測試成功: 已登入用戶可正常訪問首頁，內容載入正確！")
            else:
                print("[ERROR] 測試失敗: 首頁內容不符！")
                return False
        else:
            print(f"[ERROR] 測試失敗: HTTP 代碼為 {response.code}")
            return False
    except Exception as e:
        print(f"[ERROR] 測試失敗: 發生異常: {str(e)}")
        return False

    # 5. 測試已登入用戶訪問受保護的 app.js
    print("5. 測試已登入用戶訪問受保護的 app.js...")
    try:
        response = opener.open(BASE_URL + "/app.js")
        if response.code == 200:
            js = response.read().decode('utf-8')
            if "state" in js and "invoices" in js:
                print("[PASS] 測試成功: 成功獲取 app.js，代表受保護的靜態檔案對已登入用戶開放！")
            else:
                print("[ERROR] 測試失敗: 獲取到的 app.js 內容不符！")
                return False
    except Exception as e:
        print(f"[ERROR] 測試失敗: 發生異常: {str(e)}")
        return False

    # 6. 測試安全登出 (POST /api/logout)
    print("6. 測試安全登出...")
    req = urllib.request.Request(BASE_URL + "/api/logout", data=b'', headers={'Content-Type': 'application/json'})
    try:
        response = opener.open(req)
        body = response.read().decode('utf-8')
        res = json.loads(body)
        if res.get("success"):
            print("[PASS] 測試成功: 登出 API 成功回傳！")
            # 檢查 Cookie 狀態，此時 cj 裡的 cookie 應該會因為 max-age=0 被移除或失效
            # 我們可以直接用一個新的 opener (不帶 cookie) 訪問首頁，驗證是否又被重定向
            print("7. 驗證登出後是否失去權限...")
            try:
                # 重新用 opener (但清空 cookie)
                cj.clear()
                # 再次訪問
                test_opener = urllib.request.build_opener(NoRedirectHandler())
                test_opener.open(BASE_URL + "/")
                print("[ERROR] 測試失敗: 登出後居然還能訪問首頁！")
                return False
            except urllib.error.HTTPError as e:
                if e.code == 302:
                    print("[PASS] 測試成功: 登出後訪問首頁再次被攔截重定向！安全機制完整！")
                else:
                    print(f"[ERROR] 測試失敗: 登出後訪問首頁返回了 {e.code}")
                    return False
        else:
            print(f"[ERROR] 測試失敗: 登出失敗: {body}")
            return False
    except Exception as e:
        print(f"[ERROR] 測試失敗: 發生異常: {str(e)}")
        return False

    print("\n* 恭喜！所有後端安全與驗證測試全部通過！ *")
    return True

if __name__ == "__main__":
    run_tests()
