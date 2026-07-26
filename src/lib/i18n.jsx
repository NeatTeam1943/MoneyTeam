import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const STRINGS = {
  he: {
    dashboard: 'לוח בקרה', transactions: 'תנועות', shopping: 'רשימת קניות', settings: 'הגדרות',
    signOut: 'התנתקות', season: 'עונה', language: 'EN',
    income: 'הכנסה', expense: 'הוצאה', transfer: 'העברה', in_kind: 'תרומה של ציוד',
    totalIncome: 'סך הכנסות', totalExpense: 'סך הוצאות', net: 'מאזן נטו', totalInKind: 'תרומות בשווה כסף', overBudget: 'חריגה מהתקציב', waitingToBuy: 'מחכה לקנייה',
    accountBalances: 'יתרות חשבונות', incomeVsExpense: 'הכנסות מול הוצאות', byCategory: 'לפי קטגוריה', bySource: 'לפי מקור',
    add: 'הוספה', edit: 'עריכה', delete: 'מחיקה', save: 'שמירה', cancel: 'ביטול', close: 'סגירה',
    loading: 'טוען…', loadTimedOut: 'הטעינה ארכה יותר מדי — בודקים שוב',
    downloadReceipts: 'הורדת קבלות', noReceipts: 'אין קבלות להורדה', payer: 'שולם ע"י', payerHint: 'שם התלמיד/ה או המשלם (גלוי למנטורים בלבד)', otherCurrency: 'מטבע אחר', rate: 'שער', fetchingRate: 'טוען שער...', rateHint: 'ניתן לערוך את השער',
    date: 'תאריך', type: 'סוג', amount: 'סכום', account: 'חשבון', fromAccount: 'מחשבון', toAccount: 'לחשבון',
    source: 'מקור', category: 'קטגוריה', vendor: 'ספק', description: 'תיאור', receipt: 'קבלה',
    receiptNumber: 'מספר קבלה', notes: 'הערות', actions: 'פעולות', search: 'חיפוש...', all: 'הכל',
    export: 'ייצוא לאקסל', noRows: 'אין רשומות להצגה', addTransaction: 'הוספת תנועה', editTransaction: 'עריכת תנועה',
    name: 'שם', url: 'קישור', sku: 'מק״ט', priority: 'דחיפות', status: 'סטטוס', quantity: 'כמות',
    estPrice: 'מחיר משוער', plannedAccount: 'חשבון מתוכנן', wish: 'משאלה', approved: 'מאושר', ordered: 'הוזמן',
    received: 'התקבל', cancelled: 'בוטל', addItem: 'הוספת פריט', editItem: 'עריכת פריט', openLink: 'פתיחת קישור',
    seasons: 'עונות', accounts: 'חשבונות', sources: 'מקורות הכנסה', categories: 'קטגוריות',
    priorityLevels: 'רמות דחיפות', members: 'חברי צוות', role: 'תפקיד', email: 'אימייל', fullName: 'שם מלא',
    rank: 'דירוג', color: 'צבע', openingBalance: 'יתרת פתיחה', active: 'פעיל', contact: 'איש קשר',
    loginTitle: 'כניסה לפורטל',
    mentor: 'מנטור', editor: 'עורך', viewer: 'צופה', requiredField: 'שדה חובה', confirmDelete: 'למחוק?',
    student: 'תלמיד', vendors: 'ספקים', vendor: 'ספק', vendorOther: 'אחר…', parent: 'קטגוריית אב', none: '— ללא —',
    childrenExceedParent: 'הבנים חורגים מתקציב האב', lines: 'שורות', addLine: 'הוסף שורה',
    templates: 'טפסים מוכנים', template: 'טופס מוכן', templatesHint: 'הגדר טפסים שתלמידים ימלאו בעת הוספה לרשימת קניות (למשל ברגים: אורך, גודל).', fields: 'שדות', fieldLabel: 'שם השדה', needOneField: 'צריך לפחות שדה אחד', addField: 'הוסף שדה', total: 'סה״כ', needOneLine: 'צריך לפחות שורה אחת עם סכום', buySelected: 'קנה נבחרים', selected: 'נבחרו', split: 'מפוצל',
    pending_approval: 'ממתין לאישור', requestedAllByCategory: 'בוקש בעבר ומבוקש לפי קטגוריה', requestedByCategory: 'מבוקש לפי קטגוריה', actualByCategory: 'בפועל לפי קטגוריה', requestedByStatus: 'מבוקש לפי סטטוס',
    budgetVsRequested: 'יצא מול מבוקש לפי תקציב', requested: 'מבוקש', spent: 'יצא', exportShopping: 'ייצוא רשימת קניות',
    contactMentor: 'אין הרשאה. פנה למנטור.', memberUid: 'מזהה משתמש (UID)', newMemberHint: 'חבר צוות חדש נכנס עם Google ומופיע כאן ברשימת "ממתינים לאישור" למעלה. ניתן גם להוסיף ידנית לפי UID.',
    budgets: 'תקציבים', budget: 'תקציב', spent: 'נוצל', remaining: 'נותר', overall: 'כללי', uncategorized: 'ללא קטגוריה',
    setBudget: 'הגדרת תקציב',
    selectedCount: '{n} נבחרו', setToViewer: 'הפוך לצופה', deleteSelected: 'מחק נבחרים',
    confirmBulkViewer: 'להפוך {n} חברים לצופה בלבד?', confirmBulkDelete: 'למחוק {n} חברים? לא ניתן לבטל.',
    buy: 'רכישה', buyItem: 'רכישת פריט', linked: 'משויך', saved: 'נשמר', deleted: 'נמחק',
    noTxYet: 'עדיין אין תנועות.', noItemsYet: 'רשימת הקניות ריקה.', noBudgetsYet: 'עדיין לא הוגדרו תקציבים.', addFirst: 'הוספה ראשונה', noCategoriesHint: 'אין קטגוריות עדיין — הוסף קטגוריות בהגדרות → קטגוריות כדי לתקצב לפי קטגוריה.',
  },
  en: {
    dashboard: 'Dashboard', transactions: 'Transactions', shopping: 'Shopping list', settings: 'Settings',
    signOut: 'Sign out', season: 'Season', language: 'עב',
    income: 'Income', expense: 'Expense', transfer: 'Transfer', in_kind: 'Equipment donation',
    totalIncome: 'Total income', totalExpense: 'Total expense', net: 'Net balance', totalInKind: 'In-kind value', overBudget: 'Over budget', waitingToBuy: 'Waiting to buy',
    accountBalances: 'Account balances', incomeVsExpense: 'Income vs expense', byCategory: 'By category', bySource: 'By source',
    add: 'Add', edit: 'Edit', delete: 'Delete', save: 'Save', cancel: 'Cancel', close: 'Close',
    loading: 'Loading…', loadTimedOut: 'That took too long — try again',
    downloadReceipts: 'Download receipts', noReceipts: 'No receipts to download', payer: 'Paid by', payerHint: "Student or payer's name (visible to mentors only)", otherCurrency: 'Other currency', rate: 'Rate', fetchingRate: 'Fetching rate...', rateHint: 'Rate is editable',
    date: 'Date', type: 'Type', amount: 'Amount', account: 'Account', fromAccount: 'From', toAccount: 'To',
    source: 'Source', category: 'Category', vendor: 'Vendor', description: 'Description', receipt: 'Receipt',
    receiptNumber: 'Receipt no.', notes: 'Notes', actions: 'Actions', search: 'Search...', all: 'All',
    export: 'Export to Excel', noRows: 'No records to show', addTransaction: 'Add transaction', editTransaction: 'Edit transaction',
    name: 'Name', url: 'Link', sku: 'SKU', priority: 'Priority', status: 'Status', quantity: 'Qty',
    estPrice: 'Est. price', plannedAccount: 'Planned account', wish: 'Wish', approved: 'Approved', ordered: 'Ordered',
    received: 'Received', cancelled: 'Cancelled', addItem: 'Add item', editItem: 'Edit item', openLink: 'Open link',
    seasons: 'Seasons', accounts: 'Accounts', sources: 'Income sources', categories: 'Categories',
    priorityLevels: 'Priority levels', members: 'Members', role: 'Role', email: 'Email', fullName: 'Full name',
    rank: 'Rank', color: 'Color', openingBalance: 'Opening balance', active: 'Active', contact: 'Contact',
    loginTitle: 'Sign in to the portal',
    mentor: 'Mentor', editor: 'Editor', viewer: 'Viewer', requiredField: 'Required', confirmDelete: 'Delete this?',
    student: 'Student', vendors: 'Vendors', vendor: 'Vendor', vendorOther: 'Other…', parent: 'Parent category', none: '— none —',
    childrenExceedParent: 'Children exceed the parent budget', lines: 'Lines', addLine: 'Add line',
    templates: 'Templates', template: 'Template', templatesHint: 'Define forms students fill when adding to the shopping list (e.g. screws: length, size).', fields: 'Fields', fieldLabel: 'Field name', needOneField: 'Need at least one field', addField: 'Add field', total: 'Total', needOneLine: 'Need at least one line with an amount', buySelected: 'Buy selected', selected: 'selected', split: 'Split',
    pending_approval: 'Pending approval', requestedAllByCategory: 'Requested (all time) by category', requestedByCategory: 'Requested by category', actualByCategory: 'Actual by category', requestedByStatus: 'Requested by status',
    budgetVsRequested: 'Spent vs requested by budget', requested: 'Requested', spent: 'Spent', exportShopping: 'Export shopping list',
    contactMentor: 'No permission. Contact a mentor.', memberUid: 'User ID (UID)', newMemberHint: 'A new teammate signs in with Google and shows up above in "Pending users". You can also add someone manually by UID.',
    budgets: 'Budgets', budget: 'Budget', spent: 'Spent', remaining: 'Remaining', overall: 'Overall', uncategorized: 'Uncategorized',
    setBudget: 'Set budget',
    selectedCount: '{n} selected', setToViewer: 'Set to viewer', deleteSelected: 'Delete selected',
    confirmBulkViewer: 'Set {n} members to viewer-only?', confirmBulkDelete: 'Delete {n} members? This cannot be undone.',
    buy: 'Buy', buyItem: 'Buy item', linked: 'Linked', saved: 'Saved', deleted: 'Deleted',
    noTxYet: 'No transactions yet.', noItemsYet: 'The shopping list is empty.', noBudgetsYet: 'No budgets set yet.', addFirst: 'Add the first one', noCategoriesHint: 'No categories yet — add them in Settings → Categories to budget per category.',
  },
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'he')

  useEffect(() => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = lang
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr'
  }, [lang])

  const t = useCallback((key) => STRINGS[lang][key] ?? key, [lang])
  const toggle = useCallback(() => setLang((l) => (l === 'he' ? 'en' : 'he')), [])

  return <I18nContext.Provider value={{ lang, t, toggle }}>{children}</I18nContext.Provider>
}

export const useI18n = () => useContext(I18nContext)