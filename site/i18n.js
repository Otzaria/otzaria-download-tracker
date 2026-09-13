"use strict";

/* Bilingual dictionary (he/en) plus the small runtime that applies it.
   This file is loaded synchronously from <head>, before styles.css and before
   the body is parsed, exactly like theme-init.js is for the colour scheme: the
   resolved language decides <html lang> and <html dir>, so the document never
   paints in the wrong direction. Static markup keeps its Hebrew wording as the
   no-JavaScript baseline and is re-written from the dictionary as soon as the
   DOM exists; while that swap is pending for a non-Hebrew reader the body is
   hidden by a single CSS rule keyed on data-i18n-pending. */
(() => {
  const STORAGE_KEY = "otzaria-download-tracker-lang";
  const SUPPORTED = ["he", "en"];
  const BASE_LANGUAGE = "he";

  const LOCALES = {
    he: { number: "he-IL", date: "he-IL", relative: "he", collation: "he", dir: "rtl" },
    en: { number: "en-US", date: "en-US", relative: "en", collation: "en", dir: "ltr" },
  };

  const DICTIONARY = {
    he: {
      /* ---------- Document metadata ---------- */
      "meta.title": "לוח ההורדות של אוצריא",
      "meta.description":
        "לוח מעקב אחרי הורדות אוצריא: הגרסה היציבה האחרונה לפי מערכת הפעלה, סטטיסטיקות חיות וציר זמן של גרסאות GitHub הזמינות.",
      "meta.ogTitle": "לוח ההורדות של אוצריא",
      "meta.ogDescription": "הורידו את הגרסה האחרונה של אוצריא, וצפו בסטטיסטיקות ההורדה המלאות — מתעדכן מדי יום.",
      "meta.ogLocale": "he_IL",

      /* ---------- Header ---------- */
      "a11y.skipLink": "דלג לתוכן",
      "brand.aria": "לוח ההורדות של אוצריא — ראש הדף",
      "brand.name": "אוצריא",
      "brand.tagline": "לוח הורדות וסטטיסטיקה",
      "nav.aria": "ניווט ראשי",
      "nav.stats": "סטטיסטיקות",
      "nav.download": "הורדה",
      "nav.releases": "גרסאות",
      "header.officialAria": "האתר הרשמי של אוצריא",
      "header.official": "האתר הרשמי",
      "theme.group": "מצב ערכת נושא",
      "theme.light": "מצב בהיר",
      "theme.system": "התאמה אוטומטית למערכת",
      "theme.dark": "מצב כהה",
      "lang.group": "שפת הממשק",
      "lang.he": "עברית",
      "lang.en": "אנגלית",

      /* ---------- Hero ---------- */
      "hero.eyebrow": "נתוני GitHub Releases · מתעדכן מדי יום",
      "hero.title": "כל הורדה של אוצריא, במקום אחד.",
      "hero.lead": "לוח קהילתי ובלתי־רשמי שמרכז את נתוני ההורדה של אוצריא מ־GitHub.",
      "hero.about": "אוצריא — ספרייה תורנית חינמית לכל המערכות.",
      "hero.aboutLink": "לאתר הרשמי",
      "hero.cta": "הורידו את הגרסה האחרונה",
      "hero.signalTitle": "הורדות התוכנה",
      "hero.signalNote": "המתקינים של אוצריא, בשני המאגרים יחד",
      "hero.library": "הספרייה המלאה",
      "hero.deltaTotal": "עדכוני ספרייה (דלתא)",
      "hero.scopeLoading": "טוען היקף נתונים…",
      "hero.scope":
        "סך כל הקבצים שנמדדו: {downloads} הורדות בשלוש המשפחות יחד · {releases} גרסאות · {assets} קבצים",
      "hero.updated": "עדכון אחרון",
      "hero.updatedLoading": "טוען נתונים…",
      "hero.deltaText": "+{count} הורדות תוכנה מהסריקה היומית האחרונה",

      /* ---------- Key metrics ---------- */
      "metrics.aria": "מדדים מרכזיים",
      "metrics.app": "הורדות התוכנה",
      "metrics.appNote": "אותה תוכנה בדיוק — הפרויקט עבר ממאגר Sivan22 אל מאגר Otzaria, והמונים נספרים יחד.",
      "metrics.library": "הספרייה המלאה",
      "metrics.libraryNote": "קובץ הספרים המלא — הורדה כבדה אחת, לא מתקין.",
      "metrics.delta": "עדכוני ספרייה (דלתא)",
      "metrics.deltaNote": "קובצי הפרש שמעדכנים ספרייה קיימת.",
      "metrics.releases": "גרסאות שפורסמו",
      "metrics.releasesNote": "דפי Releases הזמינים כיום",

      /* ---------- Statistics section ---------- */
      "stats.kicker": "המגמה, לא ערימת מספרים",
      "stats.title": "סטטיסטיקות הורדה",
      "stats.lead": "הורדות חדשות שנמדדו בפועל, מונים מצטברים, ודירוג הגרסאות המובילות.",
      "range.aria": "טווח זמן",
      "range.7": "שבוע",
      "range.30": "30 יום",
      "range.90": "90 יום",
      "range.182": "חצי שנה",
      "range.365": "שנה",
      "range.all": "הכול",
      "range.daysFallback": "{count} ימים",

      "chart.modeAria": "סוג הגרף",
      "chart.mode.daily": "חדשות ביום",
      "chart.mode.cumulative": "מצטבר",
      "chart.mode.releases": "גרסאות מובילות",
      "chart.summaryLoading": "טוען את סדרת הזמן…",
      "chart.loading": "טוען תרשימים…",
      "chart.familyAria": "משפחת המדידה",
      "chart.chip.app": "הורדות התוכנה",
      "chart.chip.library": "הספרייה המלאה",
      "chart.chip.delta": "עדכוני ספרייה",
      "drilldown.summary": "פירוט שני המאגרים של התוכנה",
      "drilldown.aria": "פירוט מאגרי התוכנה",
      "drilldown.note": "שני המאגרים הם אותה תוכנה: הפרויקט עבר ממאגר למאגר, והפיצול נשמר רק כהיסטוריה.",
      "chart.canvasAria": "דירוג הגרסאות המובילות לפי מספר ההורדות",
      "chart.empty.title": "כאן יופיע קצב ההורדות היומי",
      "chart.empty.detail": "נדרשים לפחות שני Snapshots מימים שונים. האיסוף האוטומטי כבר מכין את הנקודה הבאה.",
      "chart.allReleasesInitial": "הצג ברשימה המלאה את כל הגרסאות",
      "chart.note.allTime":
        "המספר בכל עמודה הוא מונה מצטבר עד היום, מאז פרסום הגרסה. גרסה ותיקה צברה הורדות לאורך זמן רב יותר, ולכן מקום גבוה כאן אינו בהכרח פופולריות נוכחית.",
      "chart.note.daily": "הערך היומי הוא ההפרש החיובי בין שני Snapshots עוקבים.",
      "chart.note.cumulative": "המונה המצטבר הוא תמונת המצב שנשמרה בכל יום.",
      "chart.summary.daily": "{count} הורדות חדשות שנצפו בטווח · {family}",
      "chart.summary.cumulative": "{count} הורדות מצטברות · {family}",
      "chart.summary.empty": "אין נתונים בטווח",
      "chart.aria.daily": "הורדות חדשות ביום",
      "chart.aria.cumulative": "מונה הורדות מצטבר",
      "chart.aria.time": "{mode} של {family} לאורך זמן",
      "chart.tooltip.downloads": " הורדות: {count}",

      /* ---------- Operating-system donut ---------- */
      "donut.kicker": "לפי מערכת הפעלה",
      "donut.loading": "טוען את הפילוח…",
      "donut.canvasAria": "גרף התפלגות הורדות לפי מערכת הפעלה",
      "donut.legendAria": "פילוח לפי מערכת הפעלה — לחצו כדי לבודד מערכת",
      "donut.yourOs": "המערכת שלכם",
      "donut.legendRowAria": "{os}: {count} הורדות, {share}",
      "donut.legendRowYours": " — המערכת שלכם",
      "donut.legendRowTitle": "{os} · {count} הורדות",
      "donut.legendTotal": "סה״כ {count} הורדות · 100%",
      "donut.subtitle.sameFile": "{family} · אותו קובץ לכל המערכות",
      "donut.subtitle.calculating": "{family} · מחשב את הפילוח לטווח הנבחר…",
      "donut.subtitle.allTime": "{family} · מונים מצטברים לכל הזמן, בכל הגרסאות",
      "donut.subtitle.range": "{family} · הורדות חדשות שנמדדו בטווח «{range}»",
      "donut.fallback.snapshotError": "לא הצלחנו לטעון את תמונות המצב היומיות, ולכן מוצג הפילוח המצטבר לכל הזמן.",
      "donut.fallback.notEnough": "אין מספיק תמונות מצב יומיות לטווח הזה, ולכן מוצג הפילוח המצטבר לכל הזמן.",
      "donut.empty.allTime": "אין עדיין נתוני הורדה של {family} לפילוח לפי מערכת הפעלה.",
      "donut.empty.range":
        "לא נמדדו הורדות חדשות של {family} בטווח «{range}». בחרו טווח רחב יותר או «הכול» כדי לראות את הפילוח המצטבר.",
      "donut.canvasAriaData": "התפלגות {family} לפי מערכת הפעלה: {breakdown}",
      "donut.canvasEntry": "{os} {share} ({count})",
      "donut.tooltip": " {count} הורדות · {share}",
      "donut.tooltipHint": " לחצו לבידוד המערכת ולסינון הגרסאות",
      "donut.centerAll": "הורדות סה״כ",
      "donut.centerRange": "הורדות בטווח",
      "donut.note.allTimeSince":
        "הפילוח המצטבר סופר גם הורדות שקדמו לתחילת האיסוף היומי ({date}), ולכן הוא גדול מסכום ההורדות החדשות שבגרף שלצדו. בחרו טווח זמן כדי לראות פילוח של התקופה בלבד.",
      "donut.note.allTime": "הפילוח המצטבר סופר את כל ההורדות שנרשמו אי פעם.",
      "donut.note.other":
        "«אחר / קבצים ישנים» הם קבצים ששמם אינו מציין מערכת הפעלה — בעיקר ארכיוני התקנה מוקדמים (‎.zip, ‎.rar, ‎.7z, ‎.bin) וקובצי עזר שפורסמו לצד הגרסאות.",
      "donut.note.filename": "השיוך נעשה לפי שם הקובץ שפורסם ב־GitHub, ולא לפי המערכת שממנה בוצעה ההורדה בפועל.",
      "os.notApplicable.library":
        "קובץ הספרייה המלאה (seforim.db.zst) זהה לכל המערכות — אותו קובץ בדיוק יורד ל־Windows, macOS, Android ו־Linux. לכן אין לו פילוח לפי מערכת הפעלה.",
      "os.notApplicable.delta":
        "קובצי הדלתא הם קובצי הפרש של מסד הנתונים, זהים לכל המערכות. גם להם אין פילוח לפי מערכת הפעלה.",

      /* ---------- Release ranking ---------- */
      "ranking.scope.new": "הורדות חדשות",
      "ranking.scope.all": "הורדות",
      "ranking.calculating": "מחשב את הדירוג לטווח «{range}»…",
      "ranking.fallback.snapshotError":
        "לא הצלחנו לטעון את תמונות המצב היומיות, ולכן הדירוג מוצג לפי המונים המצטברים לכל הזמן.",
      "ranking.fallback.notEnough":
        "אין מספיק תמונות מצב יומיות לטווח הזה, ולכן הדירוג מוצג לפי המונים המצטברים לכל הזמן.",
      "ranking.allLink.range": "הצג ברשימה המלאה את כל {count} הגרסאות שנמדדו בטווח «{range}»",
      "ranking.allLink.family": "הצג ברשימה המלאה את כל {count} הגרסאות של {family}",
      "ranking.summary.emptyRange": "לא נמדדו {scope} בטווח «{range}» · {family}",
      "ranking.summary.emptyAll": "אין עדיין נתונים · {family}",
      "ranking.note.emptyRange":
        "לא נמדדו הורדות חדשות של {family} בטווח «{range}». בחרו טווח רחב יותר או «הכול» כדי לראות את הדירוג המצטבר.",
      "ranking.note.emptyAll": "אין עדיין הורדות רשומות של {family}.",
      "ranking.empty.title": "אין גרסאות לדרג בטווח הזה",
      "ranking.empty.detailRange": "אף גרסה של {family} לא נמדדה בהורדה חדשה בטווח «{range}».",
      "ranking.summary.lead": "{tag} מובילה עם {count} {scope}",
      "ranking.summary.top": " · {count} המובילות מרכזות {share} מתוך {total}",
      "ranking.summary.single": " מתוך {total}",
      "ranking.summary.family": " ב{family}",
      "ranking.summary.range": " · טווח «{range}»",
      "ranking.note.range":
        "הדירוג סופר רק הורדות חדשות שנמדדו בטווח «{range}», ולכן כל הגרסאות נמדדות באותם ימים בדיוק וגרסה ותיקה אינה נהנית מיתרון גיל.",
      "ranking.note.pickRange": "בחרו טווח זמן למעלה כדי לדרג לפי הורדות חדשות בלבד, בלי יתרון הגיל.",
      "ranking.note.click": "לחיצה על עמודה פותחת את אותה גרסה ברשימת הגרסאות המלאה שלמטה.",
      "ranking.aria.base": "דירוג {count} הגרסאות המובילות של {family} לפי {scope}",
      "ranking.aria.range": " בטווח «{range}»",
      "ranking.aria.allTime": " מאז ומתמיד",
      "ranking.tooltip.label": " {scope}: {count}",
      "ranking.tooltip.after": " תגית: {tag} · פורסמה {published}\n לחצו כדי למצוא אותה ברשימת הגרסאות",

      /* ---------- Download section ---------- */
      "download.kicker": "מותקן תוך פחות מדקה",
      "download.title": "הורדת הגרסה היציבה האחרונה",
      "download.versionLoading": "טוען פרטי גרסה…",
      "download.allPlatforms": "אודות כל הפלטפורמות",
      "download.note": "הקבצים מגיעים ישירות מ־GitHub Releases; מערכת שאינה מופיעה כאן זמינה לרוב בהיסטוריית הגרסאות.",
      "download.recommended": "מומלץ עבורכם",
      "download.unavailable": "לא פורסם קובץ עבור {platform} בגרסה היציבה הנוכחית.",
      "download.searchOlder": "חיפוש בגרסאות קודמות",
      "download.assetMeta": "{variant} · {size} · {count} הורדות לקובץ זה",
      "download.button": "הורדה",
      "download.moreOptions": "אפשרויות נוספות ({count})",
      "download.moreRow": "{variant} · {size} ↓",
      "download.noRelease": "לא נמצאה גרסה זמינה כרגע.",
      "download.versionLine": "גרסה {tag} · פורסמה {date} · {count} הורדות תוכנה עד כה",
      "download.osBanner": "זיהינו שאתם משתמשים ב־{platform} · ההורדה המומלצת מסומנת למטה",

      /* ---------- Releases list ---------- */
      "releases.kicker": "מוצאים גרסה בשניות",
      "releases.title": "כל הגרסאות",
      "releases.lead": "חיפוש וסינון לפי סוג קובץ, מערכת הפעלה, סוג גרסה וערוץ פיתוח — בלי גלילה אינסופית.",
      "releases.countLoading": "טוען…",
      "releases.searchPlaceholder": "חיפוש גרסה או קובץ, למשל 0.9.95 או windows",
      "filter.typeAria": "משפחת המדידה",
      "filter.type.all": "הכול",
      "filter.type.app": "תוכנה",
      "filter.type.library": "ספרייה ודלתאות",
      "filter.osAria": "מערכת הפעלה",
      "filter.os.all": "כל המערכות",
      "filter.advanced": "סינון מתקדם",
      "filter.repoAria": "מאגר התוכנה",
      "filter.repo.sivan22": "רק Sivan22/otzaria",
      "filter.repo.otzaria": "רק Otzaria/otzaria",
      "filter.variantAria": "סוג גרסה",
      "filter.variant.all": "כל הגרסאות",
      "filter.variant.mobile": "ניידת",
      "filter.variant.regular": "רגילה",
      "filter.variant.full": "מלאה (עם כל הרכיבים)",
      "filter.channelAria": "ערוץ גרסה",
      "filter.channel.all": "כל הערוצים",
      "filter.channel.stable": "יציבה",
      "filter.channel.dev": "פיתוח",
      "filter.channel.pr": "בדיקת PR",
      "filter.channel.early": "גרסה מוקדמת",
      "releases.loadMoreInitial": "הצג עוד גרסאות",
      "release.subtitle": "{source} · {kind} · {tag}",
      "release.githubPage": "עמוד הגרסה ב־GitHub ↗",
      "release.copyLink": "העתקת קישור",
      "release.assetDownload": "הורדה ↗",
      "release.noAssets": "לגרסה זו אין קבצים הנכללים במדדים הראשיים.",
      "release.noMatches": "לא נמצאו גרסאות המתאימות לסינון.",
      "release.count": "{count} גרסאות נמצאו",
      "release.loadMore": "הצג עוד {count} גרסאות",
      "release.downloadsTitle": "{label}: {count}",
      "releaseKind.libraryAndDelta": "ספרייה ועדכון דלתא",
      "releaseKind.library": "ספריית הספרים המלאה",
      "releaseKind.delta": "עדכון דלתא",
      "releaseKind.other": "קובצי ספרייה",

      /* ---------- Method section ---------- */
      "method.title": "איך המספרים נמדדים?",
      "method.intro": "הלוח קורא מידע ציבורי בלבד מ־GitHub Releases ומציג אותו כפי שהוא. כך זה עובד, שלב אחר שלב:",
      "method.step1.title": "קוראים את כל ה־Releases הזמינים",
      "method.step1.body":
        "המעקב עובר על כל דפי ה־API הזמינים כיום בשלושת המאגרים, ומצרף אותם לקו זמן אחד בלי לספור את המאגר שהועבר פעמיים.",
      "method.step2.title": "שומרים Snapshot יומי",
      "method.step2.body": "כל קובץ מזוהה לפי Asset ID יציב, כדי ששינוי בשם לא ייצור הורדה מדומה.",
      "method.step3.title": "מציגים רק הפרשים חיוביים",
      "method.step3.body":
        "מחיקה או החלפה של קובץ לא נרשמות כהורדות שליליות. קובץ חדש מתחיל להימדד מן ה־Snapshot הראשון שלו.",
      "method.raw": "נתונים גולמיים",
      "method.source": "קוד המקור",

      /* ---------- Footer ---------- */
      "footer.aria": "קישורי הלוח",
      "footer.raw": "נתונים גולמיים",
      "footer.license": "רישיון MIT",
      "footer.site": "אתר אוצריא",
      "footer.note": "מתעדכן אוטומטית מדי יום מנתונים ציבוריים של GitHub API",

      /* ---------- Shared labels ---------- */
      "family.app": "הורדות התוכנה",
      "family.library": "הספרייה המלאה",
      "family.delta": "עדכוני ספרייה (דלתא)",
      "family.sivan22": "התוכנה · Sivan22/otzaria",
      "family.otzaria": "התוכנה · Otzaria/otzaria",
      "category.app": "תוכנה",
      "category.library": "ספרייה",
      "category.delta": "דלתא",
      "source.sivan22": "התוכנה · מאגר Sivan22 (הקודם)",
      "source.otzaria": "התוכנה · מאגר Otzaria (הנוכחי)",
      "source.seforim": "ספריית הספרים",
      "os.windows": "Windows",
      "os.macos": "macOS",
      "os.android": "Android",
      "os.linux": "Linux",
      "os.ios": "iOS",
      "os.other": "אחר / קבצים ישנים",
      "variant.mobile": "נייד",
      "variant.regular": "רגילה",
      "variant.full": "מלאה",
      "channel.stable": "גרסה יציבה",
      "channel.dev": "גרסת פיתוח",
      "channel.pr": "בדיקת PR",
      "channel.early": "גרסה מוקדמת",
      "common.noDate": "ללא תאריך",

      /* ---------- Toasts & errors ---------- */
      "toast.osFilterCleared": "הסינון לפי מערכת הפעלה בוטל",
      "toast.osFiltered": "הגרסאות למטה סוננו ל־{os}",
      "toast.osOther": "«אחר / קבצים ישנים» אינה מערכת הפעלה — הפרוסה מודגשת בלבד",
      "toast.releaseFiltered": "רשימת הגרסאות סוננה ל־{tag}",
      "toast.linkCopied": "הקישור הועתק ללוח",
      "toast.linkCopyFailed": "לא ניתן היה להעתיק את הקישור",
      "error.fetchFailed": "טעינת {path} נכשלה ({status})",
      "error.chartLibrary": "ספריית התרשימים לא נטענה",
      "error.fileProtocol.title": "פתיחה ישירה מהקובץ לא תומכת בטעינת נתונים",
      "error.fileProtocol.detail":
        "הדפדפן חוסם בקשות fetch לקבצים מקומיים (file://) מסיבות אבטחה. כדי לבדוק את האתר במחשב, הריצו שרת מקומי מתוך תיקיית site, למשל: python3 -m http.server ואז פתחו http://localhost:8000. באתר החי, לאחר פרסום ל־GitHub Pages, הטעינה תעבוד כרגיל.",
      "error.load.title": "לא הצלחנו לטעון את הנתונים",
      "error.unavailable": "הנתונים אינם זמינים",
    },

    en: {
      /* ---------- Document metadata ---------- */
      "meta.title": "Otzaria Download Tracker",
      "meta.description":
        "A tracker for Otzaria downloads: the latest stable release for every operating system, live statistics and a timeline of the available GitHub releases.",
      "meta.ogTitle": "Otzaria Download Tracker",
      "meta.ogDescription": "Download the latest version of Otzaria and explore the full download statistics — updated daily.",
      "meta.ogLocale": "en_US",

      /* ---------- Header ---------- */
      "a11y.skipLink": "Skip to content",
      "brand.aria": "Otzaria Download Tracker — back to top",
      "brand.name": "Otzaria",
      "brand.tagline": "Downloads & statistics",
      "nav.aria": "Main navigation",
      "nav.stats": "Statistics",
      "nav.download": "Download",
      "nav.releases": "Releases",
      "header.officialAria": "Otzaria's official website",
      "header.official": "Official site",
      "theme.group": "Colour theme",
      "theme.light": "Light mode",
      "theme.system": "Match system setting",
      "theme.dark": "Dark mode",
      "lang.group": "Interface language",
      "lang.he": "Hebrew",
      "lang.en": "English",

      /* ---------- Hero ---------- */
      "hero.eyebrow": "GitHub Releases data · updated daily",
      "hero.title": "Every Otzaria download, in one place.",
      "hero.lead": "A community-run, unofficial dashboard that gathers Otzaria's download figures from GitHub.",
      "hero.about": "Otzaria — a free Torah library for every platform.",
      "hero.aboutLink": "Visit the official site",
      "hero.cta": "Download the latest release",
      "hero.signalTitle": "App downloads",
      "hero.signalNote": "Otzaria installers, across both repositories combined",
      "hero.library": "Full library",
      "hero.deltaTotal": "Delta updates",
      "hero.scopeLoading": "Loading the data scope…",
      "hero.scope": "All tracked files: {downloads} downloads across the three families · {releases} releases · {assets} files",
      "hero.updated": "Last updated",
      "hero.updatedLoading": "Loading data…",
      "hero.deltaText": "+{count} app downloads since the last daily scan",

      /* ---------- Key metrics ---------- */
      "metrics.aria": "Key metrics",
      "metrics.app": "App downloads",
      "metrics.appNote":
        "Exactly the same software — the project moved from the Sivan22 repository to the Otzaria one, and both counters are added together.",
      "metrics.library": "Full library",
      "metrics.libraryNote": "The complete book database — one heavy download, not an installer.",
      "metrics.delta": "Delta updates",
      "metrics.deltaNote": "Patch files that bring an existing library up to date.",
      "metrics.releases": "Published releases",
      "metrics.releasesNote": "Release pages available today",

      /* ---------- Statistics section ---------- */
      "stats.kicker": "The trend, not a pile of numbers",
      "stats.title": "Download statistics",
      "stats.lead": "Newly measured downloads, cumulative counters, and a ranking of the leading releases.",
      "range.aria": "Time range",
      "range.7": "Week",
      "range.30": "30 days",
      "range.90": "90 days",
      "range.182": "6 months",
      "range.365": "Year",
      "range.all": "All time",
      "range.daysFallback": "{count} days",

      "chart.modeAria": "Chart type",
      "chart.mode.daily": "New per day",
      "chart.mode.cumulative": "Cumulative",
      "chart.mode.releases": "Top releases",
      "chart.summaryLoading": "Loading the time series…",
      "chart.loading": "Loading charts…",
      "chart.familyAria": "Measurement family",
      "chart.chip.app": "App downloads",
      "chart.chip.library": "Full library",
      "chart.chip.delta": "Delta updates",
      "drilldown.summary": "Break the app down by its two repositories",
      "drilldown.aria": "App repository breakdown",
      "drilldown.note":
        "Both repositories host the same software: the project moved from one to the other, and the split is kept only as history.",
      "chart.canvasAria": "Top releases ranked by download count",
      "chart.empty.title": "The daily download rate will appear here",
      "chart.empty.detail":
        "At least two snapshots from different days are needed. The automatic collector is already preparing the next data point.",
      "chart.allReleasesInitial": "Show every release in the full list",
      "chart.note.allTime":
        "Each bar shows a cumulative counter running from the day the release was published until today. An older release has been collecting downloads for longer, so a high position here does not necessarily mean it is popular right now.",
      "chart.note.daily": "The daily value is the positive difference between two consecutive snapshots.",
      "chart.note.cumulative": "The cumulative counter is the snapshot stored on each day.",
      "chart.summary.daily": "{count} new downloads observed in this range · {family}",
      "chart.summary.cumulative": "{count} cumulative downloads · {family}",
      "chart.summary.empty": "No data in this range",
      "chart.aria.daily": "New downloads per day",
      "chart.aria.cumulative": "Cumulative download counter",
      "chart.aria.time": "{mode} for {family} over time",
      "chart.tooltip.downloads": " Downloads: {count}",

      /* ---------- Operating-system donut ---------- */
      "donut.kicker": "By operating system",
      "donut.loading": "Loading the breakdown…",
      "donut.canvasAria": "Doughnut chart of downloads by operating system",
      "donut.legendAria": "Breakdown by operating system — click to isolate one platform",
      "donut.yourOs": "your system",
      "donut.legendRowAria": "{os}: {count} downloads, {share}",
      "donut.legendRowYours": " — your system",
      "donut.legendRowTitle": "{os} · {count} downloads",
      "donut.legendTotal": "Total {count} downloads · 100%",
      "donut.subtitle.sameFile": "{family} · the same file on every platform",
      "donut.subtitle.calculating": "{family} · calculating the breakdown for the selected range…",
      "donut.subtitle.allTime": "{family} · all-time cumulative counters, across every release",
      "donut.subtitle.range": "{family} · new downloads measured in “{range}”",
      "donut.fallback.snapshotError":
        "We could not load the daily snapshots, so the all-time cumulative breakdown is shown instead.",
      "donut.fallback.notEnough":
        "There are not enough daily snapshots for this range, so the all-time cumulative breakdown is shown instead.",
      "donut.empty.allTime": "There is no data for {family} yet to break down by operating system.",
      "donut.empty.range":
        "No new downloads were measured for {family} in “{range}”. Pick a wider range, or “All time”, to see the cumulative breakdown.",
      "donut.canvasAriaData": "{family} by operating system: {breakdown}",
      "donut.canvasEntry": "{os} {share} ({count})",
      "donut.tooltip": " {count} downloads · {share}",
      "donut.tooltipHint": " Click to isolate this platform and filter the releases",
      "donut.centerAll": "downloads in total",
      "donut.centerRange": "downloads in range",
      "donut.note.allTimeSince":
        "The cumulative breakdown also counts downloads from before the daily collection began ({date}), which is why it is larger than the new-download total in the chart beside it. Pick a time range to see a breakdown of that period alone.",
      "donut.note.allTime": "The cumulative breakdown counts every download ever recorded.",
      "donut.note.other":
        "“Other / legacy files” are files whose name says nothing about an operating system — mostly early installation archives (.zip, .rar, .7z, .bin) and helper files published alongside the releases.",
      "donut.note.filename":
        "Files are attributed by the name published on GitHub, not by the system the download actually came from.",
      "os.notApplicable.library":
        "The full library file (seforim.db.zst) is identical on every platform — Windows, macOS, Android and Linux all download exactly the same file. It therefore has no per-operating-system breakdown.",
      "os.notApplicable.delta":
        "Delta files are database patches, identical on every platform. They have no per-operating-system breakdown either.",

      /* ---------- Release ranking ---------- */
      "ranking.scope.new": "new downloads",
      "ranking.scope.all": "downloads",
      "ranking.calculating": "Calculating the ranking for “{range}”…",
      "ranking.fallback.snapshotError":
        "We could not load the daily snapshots, so the ranking follows the all-time cumulative counters.",
      "ranking.fallback.notEnough":
        "There are not enough daily snapshots for this range, so the ranking follows the all-time cumulative counters.",
      "ranking.allLink.range": "Show all {count} releases measured in “{range}” in the full list",
      "ranking.allLink.family": "Show all {count} releases for {family} in the full list",
      "ranking.summary.emptyRange": "No {scope} were measured in “{range}” · {family}",
      "ranking.summary.emptyAll": "No data yet · {family}",
      "ranking.note.emptyRange":
        "No new downloads were measured for {family} in “{range}”. Pick a wider range, or “All time”, to see the cumulative ranking.",
      "ranking.note.emptyAll": "No downloads have been recorded yet for {family}.",
      "ranking.empty.title": "No releases to rank in this range",
      "ranking.empty.detailRange": "No release in {family} picked up a new download in “{range}”.",
      "ranking.summary.lead": "{tag} leads with {count} {scope}",
      "ranking.summary.top": " · the top {count} account for {share} of {total}",
      "ranking.summary.single": " out of {total}",
      "ranking.summary.family": " in {family}",
      "ranking.summary.range": " · range “{range}”",
      "ranking.note.range":
        "The ranking counts only new downloads measured in “{range}”, so every release is judged over exactly the same days and an older release gains no advantage from its age.",
      "ranking.note.pickRange": "Pick a time range above to rank by new downloads alone, without the age advantage.",
      "ranking.note.click": "Clicking a bar opens that release in the full list below.",
      "ranking.aria.base": "The top {count} {family} releases ranked by {scope}",
      "ranking.aria.range": " in “{range}”",
      "ranking.aria.allTime": " of all time",
      "ranking.tooltip.label": " {scope}: {count}",
      "ranking.tooltip.after": " Tag: {tag} · published {published}\n Click to find it in the release list",

      /* ---------- Download section ---------- */
      "download.kicker": "Installed in under a minute",
      "download.title": "Download the latest stable release",
      "download.versionLoading": "Loading release details…",
      "download.allPlatforms": "About every platform",
      "download.note":
        "Files are served straight from GitHub Releases; a platform that is missing here is usually available in the release history.",
      "download.recommended": "Recommended for you",
      "download.unavailable": "No {platform} build was published in the current stable release.",
      "download.searchOlder": "Search earlier releases",
      "download.assetMeta": "{variant} · {size} · {count} downloads of this file",
      "download.button": "Download",
      "download.moreOptions": "More options ({count})",
      "download.moreRow": "{variant} · {size} ↓",
      "download.noRelease": "No release is available right now.",
      "download.versionLine": "Release {tag} · published {date} · {count} app downloads so far",
      "download.osBanner": "Looks like you are on {platform} · the recommended download is marked below",

      /* ---------- Releases list ---------- */
      "releases.kicker": "Find a release in seconds",
      "releases.title": "All releases",
      "releases.lead": "Search and filter by file type, operating system, build type and channel — without endless scrolling.",
      "releases.countLoading": "Loading…",
      "releases.searchPlaceholder": "Search a release or file, e.g. 0.9.95 or windows",
      "filter.typeAria": "Measurement family",
      "filter.type.all": "All",
      "filter.type.app": "App",
      "filter.type.library": "Library & deltas",
      "filter.osAria": "Operating system",
      "filter.os.all": "All platforms",
      "filter.advanced": "Advanced filters",
      "filter.repoAria": "App repository",
      "filter.repo.sivan22": "Sivan22/otzaria only",
      "filter.repo.otzaria": "Otzaria/otzaria only",
      "filter.variantAria": "Build type",
      "filter.variant.all": "All builds",
      "filter.variant.mobile": "Mobile",
      "filter.variant.regular": "Standard",
      "filter.variant.full": "Full (everything bundled)",
      "filter.channelAria": "Release channel",
      "filter.channel.all": "All channels",
      "filter.channel.stable": "Stable",
      "filter.channel.dev": "Dev",
      "filter.channel.pr": "PR test",
      "filter.channel.early": "Early build",
      "releases.loadMoreInitial": "Show more releases",
      "release.subtitle": "{source} · {kind} · {tag}",
      "release.githubPage": "Release page on GitHub ↗",
      "release.copyLink": "Copy link",
      "release.assetDownload": "Download ↗",
      "release.noAssets": "This release has no files that count towards the main metrics.",
      "release.noMatches": "No releases match these filters.",
      "release.count": "{count} releases found",
      "release.loadMore": "Show {count} more releases",
      "release.downloadsTitle": "{label}: {count}",
      "releaseKind.libraryAndDelta": "Library + delta update",
      "releaseKind.library": "Full books library",
      "releaseKind.delta": "Delta update",
      "releaseKind.other": "Library files",

      /* ---------- Method section ---------- */
      "method.title": "How are these numbers measured?",
      "method.intro":
        "The tracker reads nothing but public information from GitHub Releases and shows it as it is. Here is how it works, step by step:",
      "method.step1.title": "Read every available release",
      "method.step1.body":
        "The tracker walks every API page currently available across the three repositories and merges them into a single timeline, without counting the migrated repository twice.",
      "method.step2.title": "Store a daily snapshot",
      "method.step2.body": "Every file is identified by a stable asset ID, so renaming a file never invents a download.",
      "method.step3.title": "Show positive differences only",
      "method.step3.body":
        "Deleting or replacing a file is never recorded as a negative download. A new file starts being measured from its own first snapshot.",
      "method.raw": "Raw data",
      "method.source": "Source code",

      /* ---------- Footer ---------- */
      "footer.aria": "Tracker links",
      "footer.raw": "Raw data",
      "footer.license": "MIT licence",
      "footer.site": "Otzaria website",
      "footer.note": "Updated automatically every day from public GitHub API data",

      /* ---------- Shared labels ---------- */
      "family.app": "App downloads",
      "family.library": "Full library",
      "family.delta": "Delta updates",
      "family.sivan22": "App · Sivan22/otzaria",
      "family.otzaria": "App · Otzaria/otzaria",
      "category.app": "app",
      "category.library": "library",
      "category.delta": "delta",
      "source.sivan22": "App · Sivan22 repository (former)",
      "source.otzaria": "App · Otzaria repository (current)",
      "source.seforim": "Books library",
      "os.windows": "Windows",
      "os.macos": "macOS",
      "os.android": "Android",
      "os.linux": "Linux",
      "os.ios": "iOS",
      "os.other": "Other / legacy files",
      "variant.mobile": "Mobile",
      "variant.regular": "Standard",
      "variant.full": "Full",
      "channel.stable": "Stable release",
      "channel.dev": "Dev build",
      "channel.pr": "PR test build",
      "channel.early": "Early build",
      "common.noDate": "No date",

      /* ---------- Toasts & errors ---------- */
      "toast.osFilterCleared": "Operating-system filter cleared",
      "toast.osFiltered": "The list below is now filtered to {os}",
      "toast.osOther": "“Other / legacy files” is not an operating system — the slice is only highlighted",
      "toast.releaseFiltered": "The release list is now filtered to {tag}",
      "toast.linkCopied": "Link copied to the clipboard",
      "toast.linkCopyFailed": "The link could not be copied",
      "error.fetchFailed": "Loading {path} failed ({status})",
      "error.chartLibrary": "The chart library failed to load",
      "error.fileProtocol.title": "Opening the file directly cannot load data",
      "error.fileProtocol.detail":
        "Browsers block fetch requests to local files (file://) for security reasons. To try the site locally, run a small server from the site folder — for example python3 -m http.server — and open http://localhost:8000. On the live GitHub Pages site loading works normally.",
      "error.load.title": "We could not load the data",
      "error.unavailable": "Data unavailable",
    },
  };

  /* ---------- Resolution ---------- */

  function fromQuery() {
    try {
      const value = new URLSearchParams(window.location.search).get("lang");
      return value && SUPPORTED.includes(value.toLowerCase()) ? value.toLowerCase() : null;
    } catch (_) {
      return null;
    }
  }

  function fromStorage() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return value && SUPPORTED.includes(value) ? value : null;
    } catch (_) {
      // Storage can be unavailable in hardened/private browser contexts.
      return null;
    }
  }

  /** Hebrew only when the browser really asks for it; everything else gets
   * English, which is the safer default for an unknown reader. "iw" is the
   * legacy ISO code some platforms still report for Hebrew. */
  function fromNavigator() {
    const tags = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ""];
    for (const tag of tags) {
      const primary = String(tag).toLowerCase().split("-")[0];
      if (primary === "he" || primary === "iw") return "he";
      if (SUPPORTED.includes(primary)) return primary;
    }
    return "en";
  }

  let language = fromQuery() || fromStorage() || fromNavigator();
  if (!SUPPORTED.includes(language)) language = BASE_LANGUAGE;

  /* ---------- Runtime ---------- */

  function dictionary(lang) {
    return DICTIONARY[lang] || DICTIONARY[BASE_LANGUAGE];
  }

  /** Every variable string goes through a named placeholder, never through
   * concatenation: Hebrew and English order their parts differently. */
  function translate(key, params) {
    const table = dictionary(language);
    const template = Object.prototype.hasOwnProperty.call(table, key)
      ? table[key]
      : dictionary(BASE_LANGUAGE)[key];
    if (template === undefined) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
  }

  // [marker attribute, dataset property, attribute that receives the translation]
  const TRANSLATED_ATTRIBUTES = [
    ["data-i18n-aria-label", "i18nAriaLabel", "aria-label"],
    ["data-i18n-placeholder", "i18nPlaceholder", "placeholder"],
    ["data-i18n-title", "i18nTitle", "title"],
    ["data-i18n-content", "i18nContent", "content"],
    ["data-i18n-alt", "i18nAlt", "alt"],
  ];

  function applyStatic(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = translate(element.dataset.i18n);
    });
    TRANSLATED_ATTRIBUTES.forEach(([marker, datasetKey, attribute]) => {
      root.querySelectorAll(`[${marker}]`).forEach((element) => {
        const key = element.dataset[datasetKey];
        if (key) element.setAttribute(attribute, translate(key));
      });
    });
    document.title = translate("meta.title");
  }

  function applyDocumentLanguage() {
    const root = document.documentElement;
    root.lang = language;
    root.dir = LOCALES[language].dir;
    root.dataset.lang = language;
  }

  const listeners = new Set();

  function setLanguage(next, persist = true) {
    const safe = SUPPORTED.includes(next) ? next : BASE_LANGUAGE;
    const changed = safe !== language;
    language = safe;
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, safe);
      } catch (_) {
        // The choice still holds for this page view when storage is blocked.
      }
    }
    applyDocumentLanguage();
    applyStatic();
    if (changed || !persist) listeners.forEach((listener) => listener(safe));
  }

  applyDocumentLanguage();
  // Only a reader who is about to be switched away from the authored Hebrew can
  // see a wrong-language flash, so only that reader pays with a hidden body.
  if (language !== BASE_LANGUAGE) document.documentElement.dataset.i18nPending = "";

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      try {
        applyStatic();
      } finally {
        delete document.documentElement.dataset.i18nPending;
      }
    },
    { once: true },
  );

  window.I18n = {
    STORAGE_KEY,
    SUPPORTED,
    t: translate,
    get language() {
      return language;
    },
    get dir() {
      return LOCALES[language].dir;
    },
    get isRTL() {
      return LOCALES[language].dir === "rtl";
    },
    locale(kind = "number") {
      return LOCALES[language][kind] || LOCALES[language].number;
    },
    setLanguage,
    applyStatic,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();
