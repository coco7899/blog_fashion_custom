@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 티스토리 건강블로그자동화 서버를 시작합니다...
echo 브라우저 주소: http://127.0.0.1:3000/
echo 이 창을 닫으면 서버도 종료됩니다.
node server-custom.js
pause
