#!/usr/bin/env python3
"""
macOS 自动化权限检查与修复脚本
"""
import subprocess
import sys

def check_accessibility_permission(app_name):
    """检查指定应用是否拥有辅助功能权限"""
    try:
        # 检查系统设置中的权限列表
        check_cmd = f'''sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \\
        "SELECT service, client, allowed FROM access WHERE service='kTCCServiceAccessibility' AND client LIKE '%{app_name}%'" 2>/dev/null'''
        
        check_result = subprocess.run(check_cmd, shell=True, capture_output=True, text=True)
        if "|1" in check_result.stdout:
            return True, "已授权"
        elif "|0" in check_result.stdout:
            return False, "已拒绝"
        else:
            return False, "未设置"
    except Exception as e:
        return False, f"检查失败: {e}"

def request_accessibility_permission(app_name):
    """尝试请求辅助功能权限（会弹出系统对话框）"""
    try:
        script = f'''tell application "{app_name}" to activate
delay 1
tell application "System Events" to keystroke " "
'''
        subprocess.run(['osascript', '-e', script], timeout=10)
        return True, "已弹出权限请求对话框，请手动确认。"
    except Exception as e:
        return False, f"请求失败: {e}"

def main():
    apps_to_check = ["Terminal", "iTerm", "Python", "WeChat"]
    print("🔍 正在检查 macOS 辅助功能权限...")
    
    for app in apps_to_check:
        has_perm, status = check_accessibility_permission(app)
        print(f"\n[应用查看] {app}: {status}")
        
        if not has_perm and status == "未设置":
            print(f"  ⚠️  {app} 未设置权限，正在尝试请求...")
            success, msg = request_accessibility_permission(app)
            print(f"  📢 {msg}")
        elif not has_perm:
            print(f"  ❌ 权限被拒绝，请前往[系统设置 > 隐私与安全性 > 辅助功能]手动添加。")
        else:
            print(f"  ✅ 权限正常")
    
    print("\n🛠️  权限检查完成。如有问题，请根据提示操作。")

if __name__ == "__main__":
    main()