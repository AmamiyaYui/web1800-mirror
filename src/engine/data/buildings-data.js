/* buildings-data.js — 建筑参数数据表【由 tools/gen-buildings-js.py 从 data/buildings-config.xlsx 生成】
 * 手动改此文件无效——请编辑 data/buildings-config.xlsx 后重新生成。
 */
(function (root) {
  'use strict';
  const BUILDINGS = {
  "residence": {
    "id": "residence",
    "name": "农民住宅",
    "category": "住宅",
    "tier": "farmers",
    "cost": {
      "wood": 2
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "capacity": 10,
    "upgrade": {
      "to": "residenceWorkers",
      "cost": {
        "wood": 4
      }
    }
  },
  "residenceWorkers": {
    "id": "residenceWorkers",
    "name": "工人住宅",
    "category": "住宅",
    "tier": "workers",
    "cost": {},
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "capacity": 20,
    "upgrade": {
      "to": "residenceArtisans",
      "cost": {
        "wood": 6,
        "brick": 2,
        "steel": 2
      }
    }
  },
  "residenceArtisans": {
    "id": "residenceArtisans",
    "name": "工匠住宅",
    "category": "住宅",
    "tier": "artisans",
    "cost": {
      "wood": 2
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "capacity": 30,
    "upgrade": {
      "to": "residenceEngineers",
      "cost": {
        "wood": 8,
        "brick": 3,
        "steel": 2,
        "windows": 2
      }
    }
  },
  "residenceEngineers": {
    "id": "residenceEngineers",
    "name": "工程师住宅",
    "category": "住宅",
    "tier": "engineers",
    "cost": {},
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "capacity": 40,
    "upgrade": {
      "to": "residenceInvestors",
      "cost": {
        "wood": 10,
        "brick": 4,
        "steel": 3,
        "windows": 3,
        "concrete": 3
      }
    }
  },
  "residenceInvestors": {
    "id": "residenceInvestors",
    "name": "投资人住宅",
    "category": "住宅",
    "tier": "investors",
    "cost": {},
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "capacity": 50
  },
  "sawmill": {
    "id": "sawmill",
    "name": "原木厂",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 4
    },
    "maintenance": 10,
    "production": {
      "cycle": 15,
      "inputs": {},
      "outputs": {
        "log": 1
      },
      "workforce": {
        "farmers": 5
      },
      "radius": 7,
    }
  },
  "boardmill": {
    "id": "boardmill",
    "name": "木板厂",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 10,
    "production": {
      "cycle": 15,
      "inputs": {},
      "outputs": {
        "wood": 1
      },
      "workforce": {
        "farmers": 10
      }
    }
  },
  "fishery": {
    "id": "fishery",
    "name": "渔场",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100,
      "wood": 2
    },
    "terrain": "coast",
    "size": {
      "w": 5,
      "h": 16
    },
    "maintenance": 40,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "fish": 1
      },
      "workforce": {
        "farmers": 25
      }
    }
  },
  "potatoField": {
    "id": "potatoField",
    "name": "土豆农场",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100,
      "wood": 2
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 20,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "potato": 1
      },
      "workforce": {
        "farmers": 20
      },
      "radius": 12,
    }
  },
  "distillery": {
    "id": "distillery",
    "name": "烈酒厂",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 40,
    "production": {
      "cycle": 30,
      "inputs": {
        "potato": 1
      },
      "outputs": {
        "schnapps": 1
      },
      "workforce": {
        "farmers": 50
      }
    }
  },
  "sheepFarm": {
    "id": "sheepFarm",
    "name": "绵羊牧场",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 100,
      "wood": 2
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 20,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "wool": 1
      },
      "workforce": {
        "farmers": 10
      },
      "radius": 5,
    }
  },
  "tailor": {
    "id": "tailor",
    "name": "纺织厂",
    "category": "生产",
    "tier": "farmers",
    "cost": {
      "coin": 400
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 4
    },
    "maintenance": 50,
    "production": {
      "cycle": 30,
      "inputs": {
        "wool": 1
      },
      "outputs": {
        "workclothes": 1
      },
      "workforce": {
        "farmers": 50
      }
    }
  },
  "clayPit": {
    "id": "clayPit",
    "name": "陶土矿场",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4
    },
    "terrain": "clay",
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 10,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "clay": 1
      },
      "workforce": {
        "workers": 50
      }
    }
  },
  "brickworks": {
    "id": "brickworks",
    "name": "砖厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 8
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 20,
    "production": {
      "cycle": 60,
      "inputs": {
        "clay": 1
      },
      "outputs": {
        "brick": 1
      },
      "workforce": {
        "workers": 25
      }
    }
  },
  "pigFarm": {
    "id": "pigFarm",
    "name": "猪牧场",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 40,
    "production": {
      "cycle": 60,
      "inputs": {},
      "outputs": {
        "pig": 1
      },
      "workforce": {},
      "radius": 5,
    }
  },
  "sausageFactory": {
    "id": "sausageFactory",
    "name": "香肠生产厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 80,
    "production": {
      "cycle": 60,
      "inputs": {
        "pig": 1
      },
      "outputs": {
        "sausage": 1
      },
      "workforce": {
        "workers": 50
      }
    }
  },
  "grainFarm": {
    "id": "grainFarm",
    "name": "谷物农场",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 20,
    "production": {
      "cycle": 60,
      "inputs": {},
      "outputs": {
        "grain": 1
      },
      "workforce": {},
      "radius": 24,
    }
  },
  "mill": {
    "id": "mill",
    "name": "磨坊",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 50,
    "production": {
      "cycle": 30,
      "inputs": {
        "grain": 1
      },
      "outputs": {
        "flour": 1
      },
      "workforce": {
        "workers": 10
      }
    }
  },
  "bakery": {
    "id": "bakery",
    "name": "面包店",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 60,
    "production": {
      "cycle": 60,
      "inputs": {
        "flour": 1
      },
      "outputs": {
        "bread": 1
      },
      "workforce": {
        "workers": 50
      }
    }
  },
  "charcoalKiln": {
    "id": "charcoalKiln",
    "name": "炭窑",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 20,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "coal": 1
      },
      "workforce": {
        "workers": 10
      }
    }
  },
  "ironMine": {
    "id": "ironMine",
    "name": "铁矿",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": "iron",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 50,
    "production": {
      "cycle": 15,
      "inputs": {},
      "outputs": {
        "ironOre": 1
      },
      "workforce": {
        "workers": 50
      }
    }
  },
  "blastFurnace": {
    "id": "blastFurnace",
    "name": "高炉",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 7
    },
    "maintenance": 100,
    "production": {
      "cycle": 30,
      "inputs": {
        "ironOre": 1,
        "coal": 1
      },
      "outputs": {
        "steelBar": 1
      },
      "workforce": {
        "workers": 100
      }
    }
  },
  "steelWorks": {
    "id": "steelWorks",
    "name": "钢材厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 1000,
      "wood": 8,
      "brick": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 10
    },
    "maintenance": 200,
    "production": {
      "cycle": 45,
      "inputs": {
        "steelBar": 1
      },
      "outputs": {
        "steel": 1
      },
      "workforce": {
        "workers": 200
      }
    }
  },
  "renderingWorks": {
    "id": "renderingWorks",
    "name": "精炼厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5,
      "steel": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 40,
    "production": {
      "cycle": 60,
      "inputs": {
        "pig": 1
      },
      "outputs": {
        "lard": 1
      },
      "workforce": {
        "workers": 40
      }
    }
  },
  "soapFactory": {
    "id": "soapFactory",
    "name": "肥皂厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5,
      "steel": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 4
    },
    "maintenance": 50,
    "production": {
      "cycle": 30,
      "inputs": {
        "lard": 1
      },
      "outputs": {
        "soap": 1
      },
      "workforce": {
        "workers": 50
      }
    }
  },
  "hopFarm": {
    "id": "hopFarm",
    "name": "啤酒花农场",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 20,
    "production": {
      "cycle": 90,
      "inputs": {},
      "outputs": {
        "hops": 1
      },
      "workforce": {},
      "radius": 16,
    }
  },
  "maltWorks": {
    "id": "maltWorks",
    "name": "麦芽加工厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 500,
      "wood": 4,
      "brick": 5,
      "steel": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 5
    },
    "maintenance": 150,
    "production": {
      "cycle": 30,
      "inputs": {
        "grain": 1
      },
      "outputs": {
        "malt": 1
      },
      "workforce": {
        "workers": 25
      }
    }
  },
  "brewery": {
    "id": "brewery",
    "name": "酿酒厂",
    "category": "生产",
    "tier": "workers",
    "cost": {
      "coin": 1600,
      "wood": 4,
      "brick": 5,
      "steel": 4
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 5
    },
    "maintenance": 200,
    "production": {
      "cycle": 60,
      "inputs": {
        "malt": 1,
        "hops": 1
      },
      "outputs": {
        "beer": 1
      },
      "workforce": {
        "workers": 75
      }
    }
  },
  "sandPit": {
    "id": "sandPit",
    "name": "砂石采集场",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 2000,
      "wood": 6,
      "brick": 5
    },
    "terrain": "coast",
    "size": {
      "w": 6,
      "h": 16
    },
    "maintenance": 120,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "sand": 1
      },
      "workforce": {}
    }
  },
  "glassworks": {
    "id": "glassworks",
    "name": "玻璃厂",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 5400,
      "wood": 6,
      "brick": 10,
      "steel": 8
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 6
    },
    "maintenance": 100,
    "production": {
      "cycle": 30,
      "inputs": {
        "sand": 1
      },
      "outputs": {
        "glass": 1
      },
      "workforce": {
        "artisans": 100
      }
    }
  },
  "windowFactory": {
    "id": "windowFactory",
    "name": "窗户厂",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 6500,
      "wood": 12,
      "brick": 20,
      "steel": 16
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 200,
    "production": {
      "cycle": 60,
      "inputs": {
        "glass": 1,
        "log": 1
      },
      "outputs": {
        "windows": 1
      },
      "workforce": {
        "artisans": 100
      }
    }
  },
  "cattleFarm": {
    "id": "cattleFarm",
    "name": "牛牧场",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 2000,
      "wood": 6
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 5
    },
    "maintenance": 50,
    "production": {
      "cycle": 120,
      "inputs": {},
      "outputs": {
        "beef": 1
      },
      "workforce": {},
      "radius": 8,
    }
  },
  "pepperFarm": {
    "id": "pepperFarm",
    "name": "红椒农场",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 2000,
      "wood": 6
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 100,
    "production": {
      "cycle": 120,
      "inputs": {},
      "outputs": {
        "pepper": 1
      },
      "workforce": {},
      "radius": 18,
    }
  },
  "artisanKitchen": {
    "id": "artisanKitchen",
    "name": "工匠厨房",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 7000,
      "wood": 6,
      "brick": 10,
      "steel": 8,
      "windows": 8
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 100,
    "production": {
      "cycle": 120,
      "inputs": {
        "beef": 1,
        "pepper": 1
      },
      "outputs": {
        "cannedFood": 1
      },
      "workforce": {
        "artisans": 75
      }
    }
  },
  "cannery": {
    "id": "cannery",
    "name": "罐头工厂",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 15000,
      "wood": 6,
      "brick": 10,
      "steel": 8,
      "windows": 8
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 100,
    "production": {
      "cycle": 120,
      "inputs": {
        "cannedFood": 1,
        "ironOre": 1
      },
      "outputs": {
        "canned": 1
      },
      "workforce": {
        "artisans": 75
      }
    }
  },
  "coalMine": {
    "id": "coalMine",
    "name": "煤矿",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 600,
      "wood": 4,
      "brick": 5
    },
    "terrain": "coal",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 50,
    "production": {
      "cycle": 15,
      "inputs": {},
      "outputs": {
        "coal": 1
      },
      "workforce": {}
    }
  },
  "sewingMachineFactory": {
    "id": "sewingMachineFactory",
    "name": "缝纫机厂",
    "category": "生产",
    "tier": "artisans",
    "cost": {
      "coin": 12000,
      "wood": 6,
      "brick": 10,
      "steel": 8,
      "windows": 8
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 9
    },
    "maintenance": 500,
    "production": {
      "cycle": 30,
      "inputs": {
        "steelBar": 1,
        "log": 1
      },
      "outputs": {
        "sewingMachine": 1
      },
      "workforce": {
        "artisans": 150
      }
    }
  },
  "concreteWorks": {
    "id": "concreteWorks",
    "name": "混凝土厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 15000,
      "wood": 20,
      "brick": 30,
      "steel": 24,
      "windows": 25
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 6
    },
    "maintenance": 400,
    "production": {
      "cycle": 60,
      "inputs": {
        "steelBar": 1,
        "cement": 1
      },
      "outputs": {
        "concrete": 1
      },
      "workforce": {
        "engineers": 75
      }
    }
  },
  "steamWorks": {
    "id": "steamWorks",
    "name": "蒸汽机厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 75000,
      "wood": 16,
      "brick": 30,
      "steel": 24,
      "windows": 20,
      "concrete": 20
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 9
    },
    "maintenance": 1800,
    "production": {
      "cycle": 90,
      "inputs": {
        "steelBar": 1,
        "brass": 1
      },
      "outputs": {
        "steamEngine": 1
      },
      "workforce": {
        "engineers": 250
      }
    }
  },
  "saltpeterWorks": {
    "id": "saltpeterWorks",
    "name": "硝石采集场",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 12500,
      "wood": 10,
      "brick": 20,
      "steel": 16
    },
    "terrain": "coast",
    "size": {
      "w": 4,
      "h": 6
    },
    "maintenance": 500,
    "production": {
      "cycle": 120,
      "inputs": {},
      "outputs": {
        "saltpeter": 1
      },
      "workforce": {}
    }
  },
  "grapeFarm": {
    "id": "grapeFarm",
    "name": "葡萄农场",
    "category": "生产",
    "tier": "investors",
    "cost": {
      "coin": 8000,
      "wood": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 3,
      "h": 4
    },
    "maintenance": 200,
    "production": {
      "cycle": 120,
      "inputs": {},
      "outputs": {
        "grapes": 1
      },
      "workforce": {}
    }
  },
  "limestoneMine": {
    "id": "limestoneMine",
    "name": "石灰岩矿",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 6000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": "limestone",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 250,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "cement": 1
      },
      "workforce": {}
    }
  },
  "zincMine": {
    "id": "zincMine",
    "name": "锌矿",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 5000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": "zinc",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 250,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "zincOre": 1
      },
      "workforce": {}
    }
  },
  "copperMine": {
    "id": "copperMine",
    "name": "铜矿",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 5000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": "copper",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 250,
    "production": {
      "cycle": 30,
      "inputs": {},
      "outputs": {
        "copperOre": 1
      },
      "workforce": {}
    }
  },
  "goldMine": {
    "id": "goldMine",
    "name": "金矿",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 27000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": "gold",
    "size": {
      "w": 3,
      "h": 3
    },
    "maintenance": 750,
    "production": {
      "cycle": 60,
      "inputs": {},
      "outputs": {
        "goldOre": 1
      },
      "workforce": {
        "engineers": 125
      }
    }
  },
  "brassWorks": {
    "id": "brassWorks",
    "name": "黄铜冶炼厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 17000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 250,
    "production": {
      "cycle": 30,
      "inputs": {
        "zincOre": 1,
        "copperOre": 1
      },
      "outputs": {
        "brass": 1
      },
      "workforce": {}
    }
  },
  "champagneCellar": {
    "id": "champagneCellar",
    "name": "香槟酒厂",
    "category": "生产",
    "tier": "investors",
    "cost": {
      "coin": 35000,
      "wood": 10,
      "brick": 20,
      "steel": 16,
      "windows": 15
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 6
    },
    "maintenance": 1000,
    "production": {
      "cycle": 30,
      "inputs": {
        "glass": 1,
        "grapes": 1
      },
      "outputs": {
        "champagne": 1
      },
      "workforce": {}
    }
  },
  "glassesWorks": {
    "id": "glassesWorks",
    "name": "眼镜厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 17000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 6
    },
    "maintenance": 1000,
    "production": {
      "cycle": 90,
      "inputs": {
        "glass": 1,
        "brass": 1
      },
      "outputs": {
        "glasses": 1
      },
      "workforce": {
        "engineers": 100
      }
    }
  },
  "watchFactory": {
    "id": "watchFactory",
    "name": "怀表工厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 48000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 7
    },
    "maintenance": 1400,
    "production": {
      "cycle": 30,
      "inputs": {
        "goldOre": 1,
        "glass": 1
      },
      "outputs": {
        "pocketWatch": 1
      },
      "workforce": {
        "engineers": 150
      }
    }
  },
  "filamentWorks": {
    "id": "filamentWorks",
    "name": "灯丝厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 30000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 7
    },
    "maintenance": 725,
    "production": {
      "cycle": 60,
      "inputs": {
        "coal": 1
      },
      "outputs": {
        "filament": 1
      },
      "workforce": {
        "engineers": 150
      }
    }
  },
  "bulbFactory": {
    "id": "bulbFactory",
    "name": "灯泡工厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 45000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 6
    },
    "maintenance": 1000,
    "production": {
      "cycle": 60,
      "inputs": {
        "filament": 1,
        "glass": 1
      },
      "outputs": {
        "lightBulb": 1
      },
      "workforce": {
        "engineers": 150
      }
    }
  },
  "veneerWorks": {
    "id": "veneerWorks",
    "name": "薄木片工厂",
    "category": "生产",
    "tier": "investors",
    "cost": {
      "coin": 22000,
      "wood": 10,
      "brick": 20,
      "steel": 16,
      "windows": 15
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 750,
    "production": {
      "cycle": 60,
      "inputs": {
        "log": 1
      },
      "outputs": {
        "veneer": 1
      },
      "workforce": {}
    }
  },
  "phonographWorks": {
    "id": "phonographWorks",
    "name": "留声机工厂",
    "category": "生产",
    "tier": "investors",
    "cost": {
      "coin": 60000,
      "wood": 10,
      "brick": 20,
      "steel": 16,
      "windows": 15
    },
    "terrain": ["plain"],
    "size": {
      "w": 7,
      "h": 7
    },
    "maintenance": 1600,
    "production": {
      "cycle": 120,
      "inputs": {
        "veneer": 1,
        "brass": 1
      },
      "outputs": {
        "phonograph": 1
      },
      "workforce": {}
    }
  },
  "oilRefinery": {
    "id": "oilRefinery",
    "name": "炼油厂",
    "category": "生产",
    "tier": "engineers",
    "cost": {
      "coin": 25000,
      "wood": 8,
      "brick": 15,
      "steel": 12,
      "windows": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 250,
    "production": {
      "cycle": 15,
      "inputs": {},
      "outputs": {
        "oil": 1
      },
      "workforce": {}
    }
  },
  "warehouse": {
    "id": "warehouse",
    "name": "仓库",
    "category": "服务",
    "tier": "farmers",
    "cost": {
      "coin": 500,
      "wood": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 20,
    "service": {
      "type": "warehouse",
      "radius": 34
    },
    "special": "warehouse"
  },
  "market": {
    "id": "market",
    "name": "市场",
    "category": "服务",
    "tier": "farmers",
    "cost": {
      "coin": 500,
      "wood": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 6
    },
    "maintenance": 20,
    "service": {
      "type": "market",
      "radius": 50
    }
  },
  "bar": {
    "id": "bar",
    "name": "酒吧",
    "category": "服务",
    "tier": "farmers",
    "cost": {
      "coin": 500,
      "wood": 10
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 6
    },
    "maintenance": 20,
    "service": {
      "type": "bar",
      "radius": 43
    }
  },
  "school": {
    "id": "school",
    "name": "学校",
    "category": "服务",
    "tier": "workers",
    "cost": {
      "coin": 2500,
      "wood": 20,
      "brick": 25,
      "steel": 20
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 6
    },
    "maintenance": 50,
    "service": {
      "type": "school",
      "radius": 50
    }
  },
  "church": {
    "id": "church",
    "name": "教堂",
    "category": "服务",
    "tier": "workers",
    "cost": {
      "coin": 2500,
      "wood": 20,
      "brick": 20
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 8
    },
    "maintenance": 50,
    "service": {
      "type": "church",
      "radius": 58
    }
  },
  "university": {
    "id": "university",
    "name": "大学",
    "category": "服务",
    "tier": "artisans",
    "cost": {
      "coin": 15000,
      "wood": 30,
      "brick": 50,
      "steel": 40,
      "windows": 40
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 9
    },
    "maintenance": 400,
    "service": {
      "type": "university",
      "radius": 65
    }
  },
  "theater": {
    "id": "theater",
    "name": "剧院",
    "category": "服务",
    "tier": "artisans",
    "cost": {
      "coin": 10000,
      "wood": 30,
      "brick": 50,
      "steel": 40,
      "windows": 40
    },
    "terrain": ["plain"],
    "size": {
      "w": 4,
      "h": 5
    },
    "maintenance": 100,
    "service": {
      "type": "theater",
      "radius": 58
    }
  },
  "bank": {
    "id": "bank",
    "name": "银行",
    "category": "服务",
    "tier": "engineers",
    "cost": {
      "coin": 100000,
      "wood": 40,
      "brick": 75,
      "steel": 60,
      "windows": 60,
      "concrete": 50
    },
    "terrain": ["plain"],
    "size": {
      "w": 12,
      "h": 10
    },
    "maintenance": 1000,
    "service": {
      "type": "bank",
      "radius": 65
    }
  },
  "powerPlant": {
    "id": "powerPlant",
    "name": "燃油发电厂",
    "category": "服务",
    "tier": "engineers",
    "cost": {
      "coin": 25000,
      "wood": 30,
      "brick": 50,
      "steel": 40,
      "windows": 30
    },
    "terrain": ["plain"],
    "size": {
      "w": 5,
      "h": 5
    },
    "maintenance": 400,
    "service": {
      "type": "electricity",
      "radius": 33
    }
  },
  "club": {
    "id": "club",
    "name": "会员俱乐部",
    "category": "服务",
    "tier": "investors",
    "cost": {
      "coin": 50000,
      "wood": 50,
      "brick": 100,
      "steel": 80,
      "windows": 75,
      "concrete": 75
    },
    "terrain": ["plain"],
    "size": {
      "w": 6,
      "h": 6
    },
    "maintenance": 350,
    "service": {
      "type": "club",
      "radius": 50
    }
  }
};
  const api = { BUILDINGS };
  root.Engine = root.Engine || {};
  root.Engine.buildingsData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
