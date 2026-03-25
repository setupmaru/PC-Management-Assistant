import subprocess
import sys
import os
base = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))
real_7za = os.path.join(base, "7za_real.exe")
result = subprocess.run([real_7za] + sys.argv[1:])
code = result.returncode
sys.exit(0 if code == 2 else code)
