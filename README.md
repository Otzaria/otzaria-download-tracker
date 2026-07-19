# Otzaria Download Tracker

לוח נתונים נגיש ונעים לשימוש עבור ההורדות של אוצריא — עם ציר גרסאות לפי תאריך הפרסום, ואיסוף יומי שמתחיל לבנות **ציר הורדות אמיתי** מרגע הפעלת המאגר.

המערכת עוקבת אחר:

- גרסאות האפליקציה ב־[`Sivan22/otzaria`](https://github.com/Sivan22/otzaria/releases)
- גרסאות האפליקציה ב־[`Otzaria/otzaria`](https://github.com/Otzaria/otzaria/releases)
- הספרייה המלאה ועדכוני הדלתא ב־[`Otzaria/SeforimLibrary`](https://github.com/Otzaria/SeforimLibrary/releases)

> `Y-PLONI/otzaria` אינו מקור רביעי: GitHub מפנה אותו אל `Otzaria/otzaria`, ולכן ספירה שלו בנפרד הייתה מכפילה את אותם הנתונים.

<!-- stats:start -->
## תמונת מצב

| מדד | ערך |
|---|---:|
| כלל ההורדות המצטברות המוצגות | **110,345** |
| גרסאות `Sivan22/otzaria` | 49,484 |
| גרסאות `Otzaria/otzaria` | 57,501 |
| הספרייה המלאה | 3,313 |
| עדכוני דלתא | 47 |
| הורדות חדשות שנצפו מאז תחילת המעקב | 0 |

עדכון אחרון: `2026-07-19 21:03:21 UTC`. לתצוגה האינטראקטיבית המלאה יש להפעיל GitHub Pages.
<!-- stats:end -->

## איך זה עובד

ה־workflow שב־[`.github/workflows/collect-and-publish.yml`](.github/workflows/collect-and-publish.yml) רץ מדי יום, קורא את כל עמודי ה־Releases דרך GitHub API, שומר Snapshot יומי ומפרסם את הלוח ב־GitHub Pages.

GitHub מספק לכל קובץ מונה מצטבר נוכחי בלבד. לכן אי אפשר לשחזר הורדות יומיות מהעבר. מהרגע שהאיסוף היומי מתחיל, ההפרש בין שני Snapshots עוקבים הוא מספר ההורדות החדש שנצפה באותו פרק זמן.

### קבצי הנתונים

- `site/data/latest.json` — גרסאות, קבצים ומונים נוכחיים לתצוגה.
- `site/data/history/YYYY-MM-DD.json` — Snapshot קומפקטי לכל יום.
- `site/data/timeseries.json` — סדרת הזמן המחושבת עבור הגרפים.

## הפעלה ראשונה

1. מעלים את המאגר ל־GitHub בשם `otzaria-download-tracker`.
2. נכנסים אל **Settings → Pages** ובוחרים ב־**GitHub Actions** כמקור הפרסום.
3. מריצים פעם אחת את **Collect downloads and publish** מתוך לשונית Actions.

אין צורך ליצור Token ידני. ה־workflow משתמש ב־`GITHUB_TOKEN` המוגבל של המאגר.

להרצה מקומית:

```bash
python3 scripts/collect_downloads.py
python3 -m http.server 8000 --directory site
```

ואז פותחים `http://localhost:8000`.

## פיתוח ובדיקות

```bash
python3 -m unittest discover -s tests -v
node --check site/app.js
```

קובצי המקור שהובילו לגרסה הזאת נשמרו מקומית בתיקיית `reference/` לצורכי תיעוד בלבד. התיקייה מוחרגת מ־Git כדי שמטא־דאטה מקומי מתוך ייצואי ה־HTML לא יפורסם במאגר.

## רישיון

[MIT](LICENSE)
