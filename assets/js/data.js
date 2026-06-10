/* ============================================================================
 * MCQ Café POS — Seed Data
 * Menu catalog, categories, promotions and default store configuration.
 * Everything here is the *default* dataset. Once the app runs, the live copy
 * lives in localStorage and can be edited from Menu Manager / Settings.
 * ==========================================================================*/
(function (global) {
  'use strict';

  // ---- Categories -----------------------------------------------------------
  const CATEGORIES = [
    { id: 'banh-mi',     name: 'Bánh Mì',            icon: '🥖', accent: '#c9772f' },
    { id: 'pho-bun',     name: 'Phở & Bún',          icon: '🍜', accent: '#9b2226' },
    { id: 'dry-noodles', name: 'Dry Noodles',        icon: '🍝', accent: '#b5651d' },
    { id: 'rice',        name: 'Rice Dishes',        icon: '🍚', accent: '#7a8450' },
    { id: 'sizzling',    name: 'Sizzling Hot Plate', icon: '🍳', accent: '#a4561d' },
    { id: 'juice',       name: 'Mixed Juice',        icon: '🥤', accent: '#2e7d5b' },
    { id: 'smoothies',   name: 'Smoothies',          icon: '🧋', accent: '#b5446e' },
    { id: 'coffee',      name: 'Vietnamese Coffee',  icon: '☕', accent: '#5c4033' },
    { id: 'lemonade',    name: 'Lemonade',           icon: '🍋', accent: '#caa307' },
    { id: 'combo',       name: 'Combo Deals',        icon: '🎁', accent: '#7251b5' },
    { id: 'bakery',      name: 'Bakery & Snacks',    icon: '🥐', accent: '#bc8a5f' }
  ];

  // ---- Menu items -----------------------------------------------------------
  // flags: noDiscount (excluded from auto promo), takeawayOnly, available
  const MENU = [
    // 🥖 Bánh Mì
    { id: 'bm-trad-pork',     cat: 'banh-mi', name: 'Traditional Pork',            price: 7 },
    { id: 'bm-roast-pork',    cat: 'banh-mi', name: 'Roasted Pork',                price: 7.5 },
    { id: 'bm-lg-chicken',    cat: 'banh-mi', name: 'Grilled Lemongrass Chicken',  price: 7 },
    { id: 'bm-lg-beef',       cat: 'banh-mi', name: 'Grilled Lemongrass Beef',     price: 7 },
    { id: 'bm-lg-pork',       cat: 'banh-mi', name: 'Grilled Lemongrass Pork',     price: 7 },
    { id: 'bm-fried-eggs',    cat: 'banh-mi', name: 'Fried Eggs',                  price: 7 },
    { id: 'bm-tofu',          cat: 'banh-mi', name: 'Fried Tofu',                  price: 7 },
    { id: 'bm-bbq-brisket',   cat: 'banh-mi', name: 'BBQ Brisket Beef',            price: 11 },
    { id: 'bm-mcq-sizzling',  cat: 'banh-mi', name: 'MCQ Special Sizzling Beef',   price: 15, noDiscount: true },
    { id: 'bm-super-roll',    cat: 'banh-mi', name: 'Super Roll (2x Meat)',        price: 13 },

    // 🍜 Phở & Bún
    { id: 'ph-raw-beef',       cat: 'pho-bun', name: 'Raw Beef Pho',                 price: 15 },
    { id: 'ph-raw-beef-balls', cat: 'pho-bun', name: 'Raw Beef & Beef Balls Pho',    price: 16 },
    { id: 'ph-brisket',        cat: 'pho-bun', name: 'Brisket Beef Pho',             price: 15 },
    { id: 'ph-mcq-special',    cat: 'pho-bun', name: 'MCQ Special Pho',              price: 16 },
    { id: 'ph-beef-rib',       cat: 'pho-bun', name: 'Slow-cooked Beef Rib Pho',     price: 20 },
    { id: 'ph-chicken',        cat: 'pho-bun', name: 'Chicken Pho',                  price: 14 },
    { id: 'ph-bun-bo-hue',     cat: 'pho-bun', name: 'Bun Bo Hue',                   price: 16 },
    { id: 'ph-pho-cup',        cat: 'pho-bun', name: 'Pho Cup',                      price: 9 },
    { id: 'ph-bbh-cup',        cat: 'pho-bun', name: 'BBH Cup',                      price: 9 },

    // 🍝 Dry Noodles
    { id: 'dn-tofu',       cat: 'dry-noodles', name: 'Stir Fried Tofu Noodles',           price: 15 },
    { id: 'dn-roast-pork', cat: 'dry-noodles', name: 'Roasted Pork Noodles',              price: 15 },
    { id: 'dn-tocino',     cat: 'dry-noodles', name: 'Grilled Tocino Noodles',            price: 17 },
    { id: 'dn-lg-chicken', cat: 'dry-noodles', name: 'Grilled Lemongrass Chicken Noodles', price: 15 },
    { id: 'dn-lg-beef',    cat: 'dry-noodles', name: 'Grilled Lemongrass Beef Noodles',   price: 15 },
    { id: 'dn-lg-pork',    cat: 'dry-noodles', name: 'Grilled Lemongrass Pork Noodles',   price: 15 },

    // 🍚 Rice Dishes
    { id: 'rc-pork-chop',  cat: 'rice', name: 'Grilled Pork Chop Broken Rice', price: 16 },
    { id: 'rc-beef',       cat: 'rice', name: 'Steamed Rice with Grilled Beef', price: 16 },
    { id: 'rc-chicken',    cat: 'rice', name: 'Grilled Chicken Rice',          price: 14 },
    { id: 'rc-roast-pork', cat: 'rice', name: 'Roasted Pork Rice',            price: 15 },
    { id: 'rc-tofu-egg',   cat: 'rice', name: 'Tofu Rice with Egg',           price: 15 },

    // 🍳 Sizzling Hot Plate
    { id: 'sz-chicken', cat: 'sizzling', name: 'Sizzling Chicken', price: 15 },
    { id: 'sz-beef',    cat: 'sizzling', name: 'Sizzling Beef',    price: 15 },
    { id: 'sz-pork',    cat: 'sizzling', name: 'Sizzling Pork',    price: 15 },
    { id: 'sz-tofu',    cat: 'sizzling', name: 'Sizzling Tofu',    price: 15 },

    // 🥤 Mixed Juice
    { id: 'jc-mixed',       cat: 'juice', name: 'Mixed Juice',       price: 7 },
    { id: 'jc-sugarcane',   cat: 'juice', name: 'Sugarcane Drink',   price: 7 },
    { id: 'jc-detox',       cat: 'juice', name: 'Detox Juice',       price: 7 },
    { id: 'jc-immunity',    cat: 'juice', name: 'Immunity Juice',    price: 7 },
    { id: 'jc-sweet-beets', cat: 'juice', name: 'Sweet Beets Juice', price: 7 },
    { id: 'jc-green-glow',  cat: 'juice', name: 'Green Glow Juice',  price: 7 },
    { id: 'jc-tropical',    cat: 'juice', name: 'Tropical Juice',    price: 7 },

    // 🧋 Smoothies
    { id: 'sm-avocado',     cat: 'smoothies', name: 'Avocado Smoothie',          price: 9 },
    { id: 'sm-strawberry',  cat: 'smoothies', name: 'Strawberry Smoothie',       price: 9 },
    { id: 'sm-mixed-berry', cat: 'smoothies', name: 'Mixed Berry Smoothie',      price: 9 },
    { id: 'sm-mango',       cat: 'smoothies', name: 'Mango Smoothie (Seasonal)', price: 9 },

    // ☕ Vietnamese Coffee
    { id: 'cf-black',        cat: 'coffee', name: 'Iced Black Coffee',  price: 7 },
    { id: 'cf-milk',         cat: 'coffee', name: 'Iced Milk Coffee',   price: 7 },
    { id: 'cf-salted-cream', cat: 'coffee', name: 'Salted Cream Coffee', price: 8 },

    // 🍋 Lemonade
    { id: 'lm-kiwi',       cat: 'lemonade', name: 'Kiwi Lemonade',       price: 8 },
    { id: 'lm-strawberry', cat: 'lemonade', name: 'Strawberry Lemonade', price: 8 },
    { id: 'lm-watermelon', cat: 'lemonade', name: 'Watermelon Lemonade', price: 8 },
    { id: 'lm-coconut',    cat: 'lemonade', name: 'Coconut Lemonade',    price: 8 },
    { id: 'lm-pineapple',  cat: 'lemonade', name: 'Pineapple Lemonade',  price: 8 },
    { id: 'lm-icetea',     cat: 'lemonade', name: 'Ice Tea Lemonade',    price: 8 },

    // 🎁 Combo Deals  (fixed price, NO auto Bánh Mì discount)
    {
      id: 'combo-drink', cat: 'combo', name: 'Bánh Mì + Drink', price: 8, isCombo: true,
      combo: {
        slots: [
          { label: 'Choose Bánh Mì', from: ['banh-mi'] },
          { label: 'Choose Drink',   from: ['juice', 'lemonade'] }
        ]
      }
    },
    {
      id: 'combo-coffee', cat: 'combo', name: 'Bánh Mì + Vietnamese Coffee', price: 10, isCombo: true,
      combo: {
        slots: [
          { label: 'Choose Bánh Mì',   from: ['banh-mi'] },
          { label: 'Choose Coffee',    from: ['coffee'] }
        ]
      }
    },

    // 🥐 Bakery & Snacks
    { id: 'bk-banh-tieu-hollow',  cat: 'bakery', name: 'Banh Tieu (Hollow Sesame Donut)', price: 3 },
    { id: 'bk-banh-tieu-dau',     cat: 'bakery', name: 'Banh Tieu Dau (Sesame Donut)',    price: 3 },
    { id: 'bk-chao-quay',         cat: 'bakery', name: 'Chao Quay (Chinese Doughnut)',    price: 3 },
    { id: 'bk-mung-bean-ball',    cat: 'bakery', name: 'Mung Bean Sesame Ball',           price: 3 },
    { id: 'bk-red-bean-ball',     cat: 'bakery', name: 'Red Bean Sesame Ball',            price: 3 },
    { id: 'bk-banh-bao',          cat: 'bakery', name: 'Banh Bao (Steam Bun)',            price: 5.5 },
    { id: 'bk-banh-tai-yen',      cat: 'bakery', name: 'Banh Tai Yen (Bird Nest Cake)',   price: 2.5 },
    { id: 'bk-batiso',            cat: 'bakery', name: 'Batiso',                          price: 3 },
    { id: 'bk-fried-pork-dump',   cat: 'bakery', name: 'Fried Pork Dumpling',             price: 3 },
    { id: 'bk-fried-banana',      cat: 'bakery', name: 'Fried Banana',                    price: 3 },
    { id: 'bk-chao-quay-rubi',    cat: 'bakery', name: 'Chao Quay (Rubi Bakery)',         price: 3 },
    { id: 'bk-banh-tieu-rubi',    cat: 'bakery', name: 'Banh Tieu (Rubi Bakery)',         price: 3 },
    { id: 'bk-banh-cam-rubi',     cat: 'bakery', name: 'Banh Cam (Rubi Bakery)',          price: 3 },
    { id: 'bk-meat-spring-roll',  cat: 'bakery', name: 'Meat Spring Roll',                price: 2.5 },
    { id: 'bk-chicken-curry-puff', cat: 'bakery', name: 'Chicken Curry Puffs',            price: 3 }
  ];

  // ---- Promotions -----------------------------------------------------------
  // The engine in store.js reads these rules at checkout time.
  const PROMOTIONS = [
    {
      id: 'banh-mi-15',
      name: '15% OFF Bánh Mì',
      type: 'category_percent',     // discount = % off matching line items
      category: 'banh-mi',
      percent: 15,
      excludeItemIds: ['bm-mcq-sizzling'], // MCQ Special Sizzling Beef excluded
      excludeCombos: true,                 // does NOT apply to combos
      startDate: '',                       // '' = no start bound (ongoing)
      endDate: '',                         // '' = no end bound (until further notice)
      active: true,
      note: '15% off all Bánh Mì except MCQ Special Sizzling Beef. Does not apply to combos.'
    }
  ];

  // ---- Modifier groups (Add-ons / Extras / Preferences) ---------------------
  // Powers the "Customize" sheet. Priced options add to the line; `free` groups
  // (preferences) are kitchen instructions with no price. `appliesTo` decides
  // which groups appear for a given item.
  const MODIFIER_GROUPS = [
    {
      id: 'banhmi-addons', name: 'Bánh Mì Add-ons', appliesTo: { categories: ['banh-mi', 'combo'] },
      options: [
        { name: 'Pâté', price: 1 },
        { name: 'Butter', price: 1 },
        { name: 'Salad', price: 1 },
        { name: 'Sauce', price: 1 },
        { name: 'Chả lụa (1 slice)', price: 1 },
        { name: 'Red pork (per slice)', price: 1, repeatable: true },
        { name: 'Egg', price: 2 },
        { name: 'Roast pork', price: 5 },
        { name: 'Plain roll', price: 1.20 }
      ]
    },
    {
      id: 'rice-extras', name: 'Rice Extras', appliesTo: { categories: ['rice', 'sizzling'] },
      options: [
        { name: 'Extra rice', price: 2 },
        { name: 'Extra tofu', price: 2 },
        { name: 'Egg', price: 2 },
        { name: 'Extra roast pork', price: 5 },
        { name: 'Extra pork rib (cơm sườn)', price: 7 },
        { name: 'Extra chicken piece', price: 8 }
      ]
    },
    {
      id: 'universal-extras', name: 'Extras', appliesTo: { all: true },
      options: [
        { name: 'Extra soup', price: 3 },
        { name: 'Extra rice noodle', price: 1 },
        { name: 'Container', price: 1, repeatable: true }
      ]
    },
    {
      id: 'banhmi-prefs', name: 'Bánh Mì options (no charge)', free: true, appliesTo: { categories: ['banh-mi'] },
      options: [
        { name: 'Cut in half' },
        { name: 'Change gloves (vegetarian)' },
        { name: 'No mayo' },
        { name: 'No cucumber' },
        { name: 'No pickle' },
        { name: 'No pâté' },
        { name: 'No butter' }
      ]
    },
    {
      id: 'rice-prefs', name: 'Rice options (no charge)', free: true, appliesTo: { categories: ['rice', 'sizzling'] },
      options: [
        { name: 'Extra soy sauce' },
        { name: 'Extra fish sauce' },
        { name: 'Extra small bowl' }
      ]
    },
    {
      id: 'preferences', name: 'Preferences (no charge)', free: true, appliesTo: { all: true },
      options: [
        { name: 'No coriander' }, { name: 'No onion' }, { name: 'No chilli' },
        { name: 'Extra chilli' }, { name: 'Spicy' }, { name: 'Less spicy' },
        { name: 'No soy sauce' }, { name: 'No sauce' }, { name: 'Extra sauce' },
        { name: 'No ice' }, { name: 'Less ice' },
        { name: 'No vegetables' }, { name: 'Gluten free' }, { name: 'Add utensils' }
      ]
    }
  ];

  // ---- Default store configuration -----------------------------------------
  const CONFIG = {
    seedVersion: 7,            // bump to migrate persisted store details
    storeName: 'MCQ Café',
    tagline: 'Vietnamese Street Food',
    address: 'Shop MM4/43 Yirrigan Dr, Mirrabooka WA 6061',
    phone: '',
    abn: '',
    logo: 'assets/images/mcq-logo.jpg', // default brand mark; replace in Settings
    currency: '$',
    taxRate: 0.10,            // 10% GST
    taxLabel: 'GST',
    taxInclusive: true,       // menu prices already include tax
    cashRounding: 0,          // round cash totals to nearest (0 = off, 0.05 = AU 5c)
    cashier: 'Cashier 1',     // active cashier (set on login)
    receiptFooter: 'Thank you for dining with MCQ Café! Xin cảm ơn quý khách 🌸',
    orderSeq: 1001,           // internal unique order id (never resets)
    // Staff accounts. role: 'admin' (full access) | 'user' (register only).
    users: [
      { id: 'u-admin', name: 'Manager',   pin: '1234', role: 'admin' },
      { id: 'u-1',     name: 'Cashier 1',  pin: '1111', role: 'user' },
      { id: 'u-2',     name: 'Cashier 2',  pin: '2222', role: 'user' }
    ]
  };

  global.MCQ_DATA = {
    CATEGORIES,
    MENU,
    MODIFIER_GROUPS,
    PROMOTIONS,
    CONFIG,
    VERSION: 7
  };
})(window);
