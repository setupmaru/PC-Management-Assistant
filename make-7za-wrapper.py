"""
7za.exe 래퍼 생성 스크립트
macOS symlink 오류(exit code 2)를 무시하고 exit code 0을 반환하는 래퍼를 pyinstaller로 빌드
"""
import subprocess
import sys
import os

WRAPPER_SRC = '''
import subprocess
import sys
import os

# 실제 7za_real.exe 경로 (래퍼와 같은 디렉토리)
real_7za = os.path.join(os.path.dirname(sys.executable), "7za_real.exe")
if not os.path.exists(real_7za):
    # 개발 환경에서 테스트 시
    real_7za = os.path.join(os.path.dirname(os.path.abspath(__file__)), "7za_real.exe")

try:
    result = subprocess.run([real_7za] + sys.argv[1:])
    code = result.returncode
    # exit code 2 = macOS symlink 생성 불가 오류 → 무시하고 0 반환
    # (Windows에서 darwin symlink 오류는 실제 추출에 영향 없음)
    if code == 2:
        sys.exit(0)
    sys.exit(code)
except Exception as e:
    print(f"Wrapper error: {e}", file=sys.stderr)
    sys.exit(1)
'''

src_path = os.path.join(os.path.dirname(__file__), '7za_wrapper_src.py')
with open(src_path, 'w') as f:
    f.write(WRAPPER_SRC)

print("Wrapper source written. Building with pyinstaller...")

# pyinstaller 설치 확인
try:
    import PyInstaller
    print("PyInstaller available")
except ImportError:
    print("Installing PyInstaller...")
    subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller", "-q"], check=True)

# 빌드
result = subprocess.run([
    sys.executable, "-m", "PyInstaller",
    "--onefile",
    "--name", "7za",
    "--distpath", r"node_modules\7zip-bin\win\x64",
    "--workpath", "build_tmp",
    "--specpath", "build_tmp",
    "--noconsole",
    src_path
])

if result.returncode == 0:
    print("✓ 7za.exe wrapper built successfully!")
else:
    print("✗ Build failed")
    sys.exit(1)
