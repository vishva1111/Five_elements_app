@echo off
cd /d d:\5eliment\app\treeapp\android
call "d:\5eliment\app\treeapp\android\gradlew.bat" assembleRelease --console=plain > d:\5eliment\app\treeapp\build-release-log.txt 2>&1
echo EXIT:%ERRORLEVEL% >> d:\5eliment\app\treeapp\build-release-log.txt
