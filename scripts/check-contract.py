import json,re,pathlib
root=pathlib.Path(__file__).resolve().parents[1]
spec=json.loads((root/'packages/api-contract/openapi.json').read_text())
assert spec['openapi']=='3.1.0'
seen=set()
for path,operations in spec['paths'].items():
 for method,operation in operations.items():
  assert operation['operationId'] not in seen;seen.add(operation['operationId'])
  assert operation['responses']
  for param in re.findall(r'\{(\w+)\}',path):assert any(p['name']==param and p['in']=='path' and p['required'] for p in operation['parameters'])
covered=0
for file in (root/'services/api/src').glob('*.ts'):
 for method,path in re.findall(r"(?:profiles|discovery|authentication|messaging|media|safety|administration|purchases)\s*\.\s*(get|post|patch|put|delete)\(\s*[\"']([^\"']+)[\"']",file.read_text()):
  if path=='/health' or path.startswith('/dev/'):continue
  full=('/v1/auth' if file.stem=='auth' else '/v1/admin' if file.stem=='admin' else '/v1')+re.sub(r':(\w+)',r'{\1}',path)
  covered+=1
  assert full in spec['paths'] and method in spec['paths'][full],(file,path,'missing in OpenAPI')
assert covered>=50, f'Route scanner found only {covered} routes'
print(f'Contract passed: {len(seen)} operations, unique IDs, path parameters, implemented route coverage.')
