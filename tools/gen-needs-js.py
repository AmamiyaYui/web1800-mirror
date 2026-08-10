# -*- coding: utf-8 -*-
# gen-needs-js.py:data/人工核查表.xlsx「需求」子表 → src/engine/data/needs-data.js
# 换算:rate(每人每秒) = 消耗/住宅(每秒) ÷ 该阶层住宅容量 [玩家反馈修正:wiki 列=每住宅口径]
#       income(每人口每分钟) = 收入/住宅(每分钟) ÷ 该阶层容量
#       influx/happiness 直接用;服务型需求(无消耗) → {service: 对应建筑类型}
import openpyxl, json, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "wiki-reference", "人工核查表.xlsx")
DST = os.path.join(ROOT, "src", "engine", "data", "needs-data.js")

CAPS = {"farmers": 10, "workers": 20, "artisans": 30, "engineers": 40, "investors": 50}
SERVICE_MAP = {
    "市场": "market", "学校": "school", "大学": "university", "教堂": "church",
    "剧院": "theater", "酒吧": "bar", "银行": "bank", "电力": "electricity",
    "会员俱乐部": "club",
}
GOOD_MAP = {
    "鱼": "fish", "工作服": "workclothes", "烈酒": "schnapps", "香肠": "sausage",
    "面包": "bread", "肥皂": "soap", "啤酒": "beer", "罐头": "canned",
    "缝纫机": "sewingMachine", "皮草大衣": "furCoat", "朗姆酒": "rum", "眼镜": "glasses",
    "咖啡": "coffee", "灯泡": "lightBulb", "脚踏车": "bicycle", "怀表": "pocketWatch",
    "香槟": "champagne", "雪茄": "cigar", "巧克力": "chocolate", "蒸汽车": "steamCarriage",
    "首饰": "jewelry", "留声机": "phonograph",
}

wb = openpyxl.load_workbook(SRC)
ws = wb["需求"]
tiers = {}
for row in ws.iter_rows(min_row=2, values_only=True):
    if not row[0]:
        continue
    tier, name, kind = str(row[0]), str(row[1]), str(row[2])
    consume = row[3]  # 消耗/住宅(每秒);下方除以 cap 生成每人口 rate
    influx = row[4] or 0
    happ = row[5] or 0
    income = row[6] or 0  # 收入/住宅(每分钟)
    cap = CAPS[tier]
    need = {}
    if name in SERVICE_MAP:
        gid = SERVICE_MAP[name]
        need["service"] = gid
        if influx: need["influx"] = int(influx)
        if happ: need["happiness"] = float(happ)
        if income: need["income"] = round(float(income) / cap, 6)
    else:
        gid = GOOD_MAP.get(name)
        if not gid:
            print("!! 未映射需求:", tier, name); continue
        need["rate"] = round(float(consume) / cap, 10) if consume else 0  # 每住宅每秒 → 每人每秒
        if influx: need["influx"] = int(influx)
        if happ: need["happiness"] = float(happ)
        if income: need["income"] = round(float(income) / cap, 6)
    tiers.setdefault(tier, {})[gid] = need

lines = ["// 生成文件(勿手改):gen-needs-js.py 从 人工核查表.xlsx「需求」子表生成",
         "// rate=每人每秒;income=每人口每分钟(收入/住宅÷容量);influx/happiness 原文",
         "(function (root) {",
         "  'use strict';",
         "  root.Engine = root.Engine || {};",
         "  root.Engine.needsData = " + json.dumps({"NEEDS": tiers}, ensure_ascii=False, indent=2) + ";",
         "  if (typeof module !== 'undefined' && module.exports) module.exports = root.Engine.needsData;",
         "})(typeof globalThis !== 'undefined' ? globalThis : this);"]
open(DST, "w", encoding="utf-8").write("\n".join(lines))
for t, needs in tiers.items():
    print(t, len(needs), "需求:", ",".join(needs.keys()))
print("OK:", DST)
