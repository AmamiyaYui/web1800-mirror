// 生成文件(勿手改):gen-needs-js.py 从 人工核查表.xlsx「需求」子表生成
// rate=每人每秒;income=每人口每分钟(收入/住宅÷容量);influx/happiness 原文
(function (root) {
  'use strict';
  root.Engine = root.Engine || {};
  root.Engine.needsData = {
  "NEEDS": {
    "farmers": {
      "market": {
        "service": "market",
        "influx": 5
      },
      "fish": {
        "rate": 4.16667e-05,
        "influx": 3,
        "income": 0.125
      },
      "workclothes": {
        "rate": 5.12821e-05,
        "influx": 2,
        "income": 0.375
      },
      "schnapps": {
        "rate": 5.55556e-05,
        "happiness": 8.0,
        "income": 0.375
      },
      "bar": {
        "service": "bar",
        "happiness": 12.0,
        "income": 0.15
      }
    },
    "workers": {
      "market": {
        "service": "market",
        "influx": 5
      },
      "fish": {
        "rate": 4.16667e-05,
        "influx": 3,
        "income": 0.125
      },
      "workclothes": {
        "rate": 5.12821e-05,
        "influx": 2,
        "income": 0.375
      },
      "sausage": {
        "rate": 1.66667e-05,
        "influx": 3,
        "income": 0.25
      },
      "bread": {
        "rate": 1.51515e-05,
        "influx": 3,
        "income": 0.25
      },
      "soap": {
        "rate": 6.9445e-06,
        "influx": 2,
        "income": 0.25
      },
      "school": {
        "service": "school",
        "influx": 2
      },
      "schnapps": {
        "rate": 5.55556e-05,
        "happiness": 4.0,
        "income": 0.375
      },
      "bar": {
        "service": "bar",
        "happiness": 6.0,
        "income": 0.15
      },
      "church": {
        "service": "church",
        "happiness": 7.0
      },
      "beer": {
        "rate": 1.28205e-05,
        "happiness": 3.0,
        "income": 0.625
      }
    },
    "artisans": {
      "sausage": {
        "rate": 2.22222e-05,
        "influx": 6,
        "income": 0.5
      },
      "bread": {
        "rate": 2.0202e-05,
        "influx": 6,
        "income": 0.5
      },
      "soap": {
        "rate": 9.2593e-06,
        "influx": 4,
        "income": 0.5
      },
      "school": {
        "service": "school",
        "influx": 4
      },
      "canned": {
        "rate": 5.698e-06,
        "influx": 4,
        "income": 0.25
      },
      "sewingMachine": {
        "rate": 1.5873e-05,
        "influx": 2,
        "income": 0.5
      },
      "furCoat": {
        "rate": 1.48148e-05,
        "influx": 2,
        "income": 0.75
      },
      "university": {
        "service": "university",
        "influx": 2
      },
      "church": {
        "service": "church",
        "happiness": 7.0
      },
      "beer": {
        "rate": 1.7094e-05,
        "happiness": 3.0,
        "income": 1.25
      },
      "theater": {
        "service": "theater",
        "happiness": 6.0,
        "income": 0.25
      },
      "rum": {
        "rate": 3.1746e-05,
        "happiness": 4.0,
        "income": 0.625
      }
    },
    "engineers": {
      "canned": {
        "rate": 8.547e-06,
        "influx": 12,
        "income": 0.5
      },
      "sewingMachine": {
        "rate": 2.38095e-05,
        "influx": 6,
        "income": 1.0
      },
      "furCoat": {
        "rate": 2.22222e-05,
        "influx": 6,
        "income": 1.5
      },
      "university": {
        "service": "university",
        "influx": 6
      },
      "glasses": {
        "rate": 3.7037e-06,
        "influx": 4,
        "income": 0.625
      },
      "coffee": {
        "rate": 1.96079e-05,
        "influx": 2,
        "income": 0.5
      },
      "electricity": {
        "service": "electricity",
        "influx": 2
      },
      "lightBulb": {
        "rate": 5.2083e-06,
        "influx": 2,
        "income": 0.875
      },
      "theater": {
        "service": "theater",
        "happiness": 6.0,
        "income": 0.25
      },
      "rum": {
        "rate": 4.7619e-05,
        "happiness": 4.0,
        "income": 1.25
      },
      "bicycle": {
        "rate": 1.04167e-05,
        "happiness": 5.0,
        "income": 0.875
      },
      "pocketWatch": {
        "rate": 3.268e-06,
        "happiness": 3.0,
        "income": 1.125
      },
      "bank": {
        "service": "bank",
        "happiness": 2.0,
        "income": 1.25
      }
    },
    "investors": {
      "glasses": {
        "rate": 5.9259e-06,
        "influx": 16,
        "income": 1.25
      },
      "coffee": {
        "rate": 3.13725e-05,
        "influx": 8,
        "income": 1.0
      },
      "electricity": {
        "service": "electricity",
        "influx": 8
      },
      "lightBulb": {
        "rate": 8.3333e-06,
        "influx": 8,
        "income": 1.75
      },
      "champagne": {
        "rate": 7.84e-06,
        "influx": 2,
        "income": 0.625
      },
      "cigar": {
        "rate": 7.4074e-06,
        "influx": 2,
        "income": 0.625
      },
      "chocolate": {
        "rate": 1.77778e-05,
        "influx": 2,
        "income": 0.625
      },
      "steamCarriage": {
        "rate": 2.2222e-06,
        "influx": 4,
        "income": 3.75
      },
      "bicycle": {
        "rate": 1.66667e-05,
        "happiness": 4.0,
        "income": 1.75
      },
      "pocketWatch": {
        "rate": 5.2288e-06,
        "happiness": 3.0,
        "income": 2.25
      },
      "bank": {
        "service": "bank",
        "happiness": 2.0,
        "income": 2.5
      },
      "club": {
        "service": "club",
        "happiness": 5.0,
        "income": 0.625
      },
      "jewelry": {
        "rate": 7.0175e-06,
        "happiness": 2.0,
        "income": 3.125
      },
      "phonograph": {
        "rate": 1.754e-06,
        "happiness": 4.0,
        "income": 1.875
      }
    }
  }
};
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Engine.needsData;
})(typeof globalThis !== 'undefined' ? globalThis : this);