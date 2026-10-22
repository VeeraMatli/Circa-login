import time,urllib.request
for url in ['http://127.0.0.1:8787/health','http://127.0.0.1:3000']:
 for _ in range(120):
  try:
   with urllib.request.urlopen(url,timeout=2) as response:
    if response.status==200:break
  except OSError:pass
  time.sleep(.25)
 else:raise SystemExit(f'Service failed readiness: {url}')
print('API and admin HTTP readiness passed.')
