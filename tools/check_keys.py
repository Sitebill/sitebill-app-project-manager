# Все ключи host.t('…') из web/*.mjs должны быть в локалях, а ключи 4 локалей — совпадать.
import json, re, os, glob, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
loc = {l: json.load(open(os.path.join(root, 'locales', l + '.json'), encoding='utf-8')) for l in ['ru', 'en', 'sr', 'tg']}
keys = set(loc['ru'])
used = set()
for f in glob.glob(os.path.join(root, 'web', '*.mjs')):
    s = open(f, encoding='utf-8').read()
    used |= set(re.findall(r"\bt\('([a-z_0-9]+)'\)", s))
    # Динамические: t(`prefix_${...}`) — берём все ключи с таким префиксом.
    for pre in re.findall(r"t\(`([a-z_]+)\$\{", s):
        used |= {k for k in keys if k.startswith(pre)}
    used |= set(re.findall(r"\['\w+', '((?:tab|menu)_[a-z_]+)'", s))
used |= {k for k in keys if k.startswith('err_')}
bad = False
missing = sorted(k for k in used if k not in keys)
if missing: print('missing in ru:', missing); bad = True
for l in ['en', 'sr', 'tg']:
    if set(loc[l]) != keys: print(l, 'differs:', sorted(set(loc[l]) ^ keys)); bad = True
print('unused:', sorted(keys - used))
print('keys:', len(keys))
sys.exit(1 if bad else 0)
