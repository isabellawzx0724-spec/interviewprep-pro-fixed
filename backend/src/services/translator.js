const dictionary = {
  zh: {
    hr: 'HR面',
    professional: '业务面 / 专业面',
    oneOnOne: '单面 1v1',
    group: '群面',
    technical: '技术面',
    manager: '主管 / 终面'
  },
  en: {
    'HR面': 'HR Interview',
    '业务面 / 专业面': 'Business / Functional Interview',
    '单面 1v1': '1-on-1 Interview',
    '群面': 'Group Interview',
    '技术面': 'Technical Interview',
    '主管 / 终面': 'Final / Hiring Manager Interview'
  }
}

export function translateText(text, lang = 'en') {
  return dictionary[lang]?.[text] || text
}
