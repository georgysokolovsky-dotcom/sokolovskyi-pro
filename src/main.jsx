import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { approvedArticleSlugs, approvedArticles } from './articleData';
import './styles.css';

const portraitPath = '/images/georgiy-portrait.png';
const webinarTarget = import.meta.env.VITE_WEBINAR_TARGET_URL || 'https://gipnogeorge.com/web/neuromagic/devaluation_man';
const webinarParamKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'article_id', 'topic', 'placement'];
const webinarUtmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
const defaultWebinarParams = { utm_source: 'seo', utm_medium: 'article', utm_campaign: 'mens_webinar' };
const webinarPlacements = new Set(['hero', 'inline', 'footer', 'header', 'webinar', 'contacts', 'skeleton']);

const topicLinks = [
  { label: 'Измена жены', href: '/topics/izmena-zheny/' },
  { label: 'Развод и расставание', href: '/topics/razvod/' },
  { label: 'Ревность и контроль', href: '/topics/revnost/' },
];

const allTopics = [
  { title: 'Измена жены', slug: 'izmena-zheny', description: 'Что делать после предательства, как разговаривать и принимать решения.' },
  { title: 'Развод и расставание', slug: 'razvod', description: 'Как пройти перемены без саморазрушения и сохранить контакт с детьми.' },
  { title: 'Возвращение женщины', slug: 'vozvrashchenie', description: 'О том, что зависит от твоих решений, а что нельзя контролировать.' },
  { title: 'Ревность, подозрения и контроль', slug: 'revnost', description: 'Как перестать жить в проверках и разговаривать о доверии.' },
  { title: 'Обесценивание и перекладывание вины', slug: 'obescenivanie', description: 'Как заметить повторяющийся сценарий и вернуть свои границы.' },
  { title: 'Дети после развода', slug: 'deti-posle-razvoda', description: 'Как оставаться отцом и принимать решения в интересах ребёнка.' },
  { title: 'Уверенность и уважение к себе', slug: 'uverennost', description: 'Как снова опираться на свои решения в сложной ситуации.' },
];

const articleCardOrder = [
  'kak-perezhit-izmenu-zheny',
  'chto-delat-v-pervye-dni-posle-izmeny',
  'razgovor-s-zhenoy-posle-izmeny',
  'prostit-ili-uyti-posle-izmeny',
  'vosstanovit-doverie-posle-izmeny',
  'pauza-posle-izmeny',
  'kak-perezhit-razvod',
  'skazat-detyam-o-razvode',
  'obshchatsya-s-byvshey-posle-razvoda',
  'sohranit-kontakt-s-detmi-posle-razvoda',
  'stoit-li-vozvrashchat-zhenu',
  'zhena-ushla-i-hochet-vernutsya',
  'vosstanovit-otnosheniya-posle-razryva',
  'perestat-proveryat-telefon-zheny',
  'revnost-i-podozreniya-chto-delat',
];

const articleCards = articleCardOrder.map((slug) => {
  const article = approvedArticles[slug];
  return {
    title: article.title,
    description: article.description,
    time: article.readingTime.replace(' чтения', ''),
    href: `/articles/${article.slug}/`,
  };
});

const legacyTopicArticles = [
  { title: 'Что делать в первые дни после измены жены', description: 'Как не наломать дров в первые дни и вернуть себе устойчивость.', time: '7 мин. чтения', href: '/articles/chto-delat-v-pervye-dni-posle-izмены/' },
  { title: 'Пауза после измены: зачем она нужна и как её выдержать', description: 'Как использовать паузу для ясности, а не для наказания.', time: '7 мин. чтения', href: '/articles/pauza-posle-izмены/' },
  { title: 'Разговор с женой после измены: как получить ясность', description: 'Как говорить так, чтобы получить ясность, а не новые раны.', time: '8 мин. чтения', href: '/articles/razgovor-s-zhenoy-posle-izмены/' },
  { title: 'Простить или уйти после измены: как принять своё решение', description: 'Критерии, вопросы к себе и честный взгляд без самообмана.', time: '9 мин. чтения', href: '/articles/prostit-ili-uyti-posle-izmeny/' },
  { title: 'Как восстановить доверие после измены', description: 'О действиях, которые помогают заново выстраивать правила отношений.', time: '8 мин. чтения', href: '/articles/vosstanovit-doverie-posle-izmeny/' },
];

const publishedTopicArticles = [
  { title: 'Что делать в первые дни после измены жены', description: 'Как не наломать дров в первые дни и вернуть себе устойчивость.', time: '7 мин. чтения', href: '/articles/chto-delat-v-pervye-dni-posle-izmeny/' },
  { title: 'Пауза после измены: зачем она нужна и как её выдержать', description: 'Как использовать паузу для ясности, а не для наказания.', time: '7 мин. чтения', href: '/articles/pauza-posle-izmeny/' },
  { title: 'Разговор с женой после измены: как получить ясность', description: 'Как говорить так, чтобы получить ясность, а не новые раны.', time: '8 мин. чтения', href: '/articles/razgovor-s-zhenoy-posle-izmeny/' },
  { title: 'Простить или уйти после измены: как принять своё решение', description: 'Критерии, вопросы к себе и честный взгляд без самообмана.', time: '9 мин. чтения', href: '/articles/prostit-ili-uyti-posle-izmeny/' },
  { title: 'Как восстановить доверие после измены', description: 'О действиях, которые помогают заново выстраивать правила отношений.', time: '8 мин. чтения', href: '/articles/vosstanovit-doverie-posle-izmeny/' },
];

const topicArticles = [
  ...publishedTopicArticles,
  ...['kak-perezhit-izmenu-zheny'].map((slug) => {
    const article = approvedArticles[slug];
    return { title: article.title, description: article.description, time: article.readingTime, href: `/articles/${article.slug}/` };
  }),
];

const topicArticleGroups = {
  'razvod': 'razvod',
  'vozvrashchenie': 'vozvrashchenie',
  'revnost': 'revnost',
  'deti-posle-razvoda': 'deti-posle-razvoda',
};

function getTopicArticles(topicSlug) {
  const topic = topicArticleGroups[topicSlug];
  return approvedArticleSlugs
    .filter((slug) => approvedArticles[slug].topic === topic)
    .map((slug) => {
      const article = approvedArticles[slug];
      return { title: article.title, description: article.description, time: article.readingTime, href: `/articles/${article.slug}/` };
    });
}

const relatedArticles = [
  { title: 'Стоит ли прощать измену: решение без самообмана', time: '7 мин чтения' },
  { title: 'Как говорить с женой о сложном и быть услышанным', time: '6 мин чтения' },
  { title: 'Как восстановить доверие, если вы оба этого хотите', time: '8 мин чтения' },
];

const articleTitles = {
  'kak-perezhit-razvod': 'Как пережить развод и не сломаться',
  'revnost-i-kontrol': 'Ревность: когда она разрушает отношения',
  'kak-vosstanovit-uverennost': 'Как восстановить уверенность после предательства',
  'chto-proishodit-posle-izmeny': 'Что происходит с тобой после измены жены',
  'pauza-posle-izmeny': 'Пауза после измены: зачем она и как её выдержать',
  'razgovor-posle-izmeny': 'Разговор с женой после измены: принципы и границы',
  'prostit-uyti-ili-ostatsya': 'Простить, уйти или остаться: как принять своё решение',
  'vosstanovit-sebya-posle-izmeny': 'Как восстановить себя и опору на будущее',
};

const legalPaths = ['/editorial-policy/', '/editorial-policy', '/privacy-policy/', '/privacy-policy', '/cookie-policy/', '/cookie-policy', '/personal-data-consent/', '/personal-data-consent', '/information-boundaries/', '/information-boundaries'];

function navigate(path) {
  const destination = new URL(path, window.location.origin);
  const incoming = readWebinarParams();
  webinarUtmKeys.forEach((key) => {
    if (!destination.searchParams.has(key) && incoming.has(key)) destination.searchParams.set(key, incoming.get(key));
  });
  window.history.pushState({}, '', `${destination.pathname}${destination.search}${destination.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  return path;
}

function Link({ href, children, className = '', onClick }) {
  const handleClick = (event) => {
    if (href.startsWith('/')) {
      event.preventDefault();
      navigate(href);
    }
    onClick?.();
  };
  return <a className={className} href={href} onClick={handleClick}>{children}</a>;
}

function readWebinarParams(search = window.location.search) {
  const incoming = new URLSearchParams(search);
  const params = new URLSearchParams();
  webinarParamKeys.forEach((key) => {
    const value = incoming.get(key);
    if (!value || value.length > 120) return;
    if (key === 'placement' && !webinarPlacements.has(value)) return;
    params.set(key, value);
  });
  return params;
}

function buildWebinarParams({ articleId, topic, placement }) {
  const incoming = readWebinarParams();
  const params = new URLSearchParams();
  Object.keys(defaultWebinarParams).forEach((key) => params.set(key, incoming.get(key) || defaultWebinarParams[key]));
  params.set('utm_content', incoming.get('utm_content') || articleId);
  params.set('article_id', articleId);
  params.set('topic', topic);
  params.set('placement', webinarPlacements.has(placement) ? placement : 'footer');
  return params;
}

function recordWebinarClick(params) {
  try {
    const entry = Object.fromEntries(params.entries());
    const signature = JSON.stringify(entry);
    const stored = JSON.parse(window.localStorage.getItem('pro_muzhchin_webinar_clicks') || '[]');
    const previous = stored[stored.length - 1];
    if (previous?.signature === signature && Date.now() - new Date(previous.clicked_at).getTime() < 1500) return;
    stored.push({ ...entry, signature, clicked_at: new Date().toISOString() });
    window.localStorage.setItem('pro_muzhchin_webinar_clicks', JSON.stringify(stored.slice(-50)));
  } catch {
    // Локальная фиксация клика не должна мешать переходу на регистрацию.
  }
}

function WebinarLink({ placement = 'footer', articleId = 'home', topic = 'overview', children = 'На вебинар' }) {
  const params = buildWebinarParams({ articleId, topic, placement });
  return <Link className="button button--accent" href={`/go/webinar?${params.toString()}`}>{children}</Link>;
}

function BrandMark() { return <Link className="brand-mark" href="/">PRO Мужчин</Link>; }

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  return <header className={`site-header ${menuOpen ? 'site-header--open' : ''}`}><div className="site-header__inner shell"><BrandMark /><button className="menu-toggle" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span /><span /></button><nav className="main-nav" aria-label="Основная навигация"><Link href="/articles/" onClick={closeMenu}>Статьи</Link><Link href="/cases/" onClick={closeMenu}>Случаи</Link><Link href="/method/" onClick={closeMenu}>Подход</Link><Link href="/about/" onClick={closeMenu}>Об авторе</Link><WebinarLink placement="header">На вебинар</WebinarLink></nav></div></header>;
}

function Footer() {
  return <footer className="site-footer"><div className="shell site-footer__inner"><BrandMark /><div className="site-footer__links"><Link href="/contacts/">Контакты</Link><Link href="/editorial-policy/">Редакционная политика</Link><Link href="/privacy-policy/">Политика конфиденциальности</Link><Link href="/cookie-policy/">Файлы cookie</Link></div><p className="site-footer__note">Материалы сайта помогают разобраться в ситуации. Они не заменяют медицинскую, юридическую или экстренную помощь.</p></div></footer>;
}

function Breadcrumbs({ items }) {
  return <div className="breadcrumbs">{items.map((item, index) => <span key={item.label}>{index > 0 && <i>/</i>}{item.href ? <Link href={item.href}>{item.label}</Link> : item.label}</span>)}</div>;
}

function ArrowLink({ href, children, className = '' }) { return <Link href={href} className={`arrow-link ${className}`}>{children}<span aria-hidden="true">→</span></Link>; }

function safeArticleHref(href) { return href.includes('chto-delat-v-pervye-dni') ? '/articles/chto-delat-v-pervye-dni-posle-izmeny/' : href; }

function PageIntro({ breadcrumbs, title, lead, dark = false, children }) {
  return <section className={`page-intro ${dark ? 'page-intro--dark' : ''}`}><div className="shell">{breadcrumbs && <Breadcrumbs items={breadcrumbs} />}<h1>{title}</h1>{lead && <p className="page-intro__lead">{lead}</p>}{children}</div></section>;
}

function WebinarBand({ compact = false, articleId = 'home', topic = 'overview' }) {
  return <section className={`webinar-band ${compact ? 'webinar-band--compact' : ''}`}><div className="shell webinar-band__inner"><div className="play-mark" aria-hidden="true"><span>▷</span></div><div className="webinar-band__copy"><p className="section-label">Бесплатный вебинар</p><h2>3 шага как стать мужчиной, с которым считаются, ценят и боятся потерять</h2></div><WebinarLink placement={compact ? 'inline' : 'footer'} articleId={articleId} topic={topic}>{compact ? 'Регистрация' : 'Посмотреть вебинар'}</WebinarLink></div></section>;
}

function HomePage() {
  return <><main><section className="hero hero--home"><div className="shell hero__inner"><div className="hero__copy"><h1>Когда отношения рушатся, важно не потерять себя</h1><p className="hero__lead">Помогаю мужчинам выйти из кризиса после измены, предательства или развода и снова стать уверенными в себе.</p><div className="hero__actions"><WebinarLink placement="hero" articleId="home" topic="overview">Посмотреть вебинар</WebinarLink><Link className="text-link text-link--light" href="#start">Найти нужную тему <span>↓</span></Link></div></div><div className="hero__portrait"><img src={portraitPath} alt="Георгий Соколовский — ментор для мужчин" /><div className="portrait-caption">Георгий Соколовский<br /><span>ментор для мужчин</span></div></div></div></section><section className="topics-index shell section-space" id="start"><div className="section-heading section-heading--line"><h2>С чего начать</h2><p>Выбери ситуацию, которая сейчас ближе всего к твоей.</p></div><div className="topic-links">{topicLinks.map((topic, index) => <Link key={topic.href} href={topic.href} className="topic-link"><span>0{index + 1}</span>{topic.label}<b>↗</b></Link>)}</div></section><section className="articles-preview shell section-space"><div className="section-heading"><div><p className="section-label">Редакция PRO Мужчин</p><h2>Статьи, которые помогают разобраться</h2></div><ArrowLink href="/articles/">Все статьи</ArrowLink></div><div className="article-grid">{articleCards.map((article) => <Link href={article.href} className="article-card" key={article.href}><div className="article-card__meta"><span>{article.time} чтения</span><span>→</span></div><h3>{article.title}</h3><p>{article.description}</p><span className="article-card__more">Читать статью</span></Link>)}</div></section><section className="case-strip shell section-space"><div className="case-strip__mark" aria-hidden="true">↗</div><div className="case-strip__title"><p className="section-label">Практика</p><h2>Случаи из практики</h2></div><div className="case-strip__copy"><h3>Раздел готов к бережному наполнению</h3><p>Первые обезличенные случаи появятся после ручной проверки и отдельного подтверждения публикации.</p></div><ArrowLink href="/cases/">Открыть раздел</ArrowLink></section><section className="author-intro shell section-space"><div className="author-intro__image"><img src={portraitPath} alt="Портрет Георгия Соколовского" /></div><div className="author-intro__copy"><p className="section-label">Об авторе</p><h2>Георгий Соколовский — ментор для мужчин</h2><p>Помогаю мужчинам выйти из кризиса после измены, предательства или развода и снова стать уверенными в себе.</p><p>В работе мы разбираем не только то, что делает партнёрша. Главное — вернуть тебе способность спокойно думать, говорить и принимать решения.</p><ArrowLink href="/about/">Познакомиться с подходом</ArrowLink></div></section><WebinarBand articleId="home" topic="overview" /></main><Footer /></>;
}

function ApprovedArticlePage({ slug }) {
  const article = approvedArticles[slug] || approvedArticles['kak-perezhit-izmenu-zheny'];
  const renderBlock = (block, index) => {
    if (block.type === 'callout') return <div className="article-callout" key={`callout-${index}`}><span className="callout-mark">◊</span><p>{block.text}</p></div>;
    return <section id={block.id} key={block.id || `section-${index}`}><h2>{block.title}</h2>{block.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{block.bullets && <ul>{block.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}{block.steps && <ol className="steps-list">{block.steps.map(([title, text]) => <li key={title}><div><strong>{title}</strong><span>{text}</span></div></li>)}</ol>}</section>;
  };
  return <><main className="article-page"><div className="shell article-layout"><article className="article-content"><Breadcrumbs items={[{ label: 'Статьи', href: '/articles/' }, { label: article.category }]} /><h1>{article.title}</h1><div className="article-meta"><span>Георгий Соколовский</span><span>{article.readingTime}</span><span>Обновлено {article.updatedAt}</span></div><p className="article-intro">{article.intro}</p><div className="article-summary"><strong>В статье:</strong>{article.summary.map(([label, id]) => <a href={`#${id}`} key={id}>{label}</a>)}</div><div className="article-prose">{article.blocks.map(renderBlock)}</div></article><aside className="article-aside"><p className="aside-title">В этой статье</p><nav>{article.summary.map(([label, id]) => <a href={`#${id}`} key={id}>{label}</a>)}</nav><div className="aside-note"><span>01</span><p>{article.asideNote}</p></div></aside></div><WebinarBand compact articleId={article.id} topic={article.topic} /><section className="related shell section-space"><div className="section-heading section-heading--line"><h2>Ещё по теме</h2></div><div className="related-grid">{article.related.map(([title, href]) => <Link href={safeArticleHref(href)} className="related-card" key={title}><h3>{title}</h3><p>Связанный материал</p><span>→</span></Link>)}</div></section></main><Footer /></>;
}

function ArticlePage() {
  return <ApprovedArticlePage slug="kak-perezhit-izmenu-zheny" />;
  /* Legacy prototype markup remains below for reference until the next cleanup pass. */
  return <><main className="article-page"><div className="shell article-layout"><article className="article-content"><Breadcrumbs items={[{ label: 'Статьи', href: '/articles/' }, { label: 'Измена жены' }]} /><h1>Как мужчине пережить измену жены и сохранить себя</h1><div className="article-meta"><span>Георгий Соколовский</span><span>8 мин чтения</span><span>Обновлено 3 сентября 2026</span></div><p className="article-intro">Если тебя накрывает после измены, первая задача — не принять решение в состоянии, когда тобой управляют страх и унижение.</p><div className="article-summary"><strong>В статье:</strong><a href="#first-weeks">что происходит</a><a href="#mistakes">какие ошибки усиливают проблему</a><a href="#steps">что делать дальше</a></div><div className="article-prose"><section id="first-weeks"><h2>Что происходит в первые недели</h2><p>Измена разрушает привычную картину мира. Появляются волны боли, злости, стыда, растерянности. Мозг пытается найти объяснение и вернуть контроль — поэтому хочется немедленно выяснять отношения, проверять телефон или делать вид, что ничего не было.</p><p>Эти реакции понятны, но они редко помогают увидеть ситуацию целиком. Сначала важно заметить, какие действия ты совершаешь из страха, а какие — потому что действительно хочешь получить ясность.</p></section><section id="mistakes"><h2>Какие действия только ухудшают ситуацию</h2><ul><li>Требования немедленных объяснений и признаний.</li><li>Слежка, проверки и чтение переписок.</li><li>Ультиматумы и угрозы.</li><li>Демонстративное безразличие и месть.</li><li>Обсуждение происходящего с людьми, которые подталкивают к импульсивному решению.</li></ul></section><div className="article-callout"><span className="callout-mark">◊</span><p>Сначала верни себе управление действиями. Решение о будущем отношений можно принимать после этого.</p></div><section id="steps"><h2>Порядок действий</h2><ol className="steps-list"><li><div><strong>Остановись и стабилизируй состояние.</strong><span>Дай себе сон, еду, движение и несколько часов без новых выяснений.</span></div></li><li><div><strong>Отдели факты от догадок.</strong><span>Не превращай каждую деталь в доказательство всего будущего.</span></div></li><li><div><strong>Определи свои границы.</strong><span>Что для тебя неприемлемо и какой разговор ты готов провести?</span></div></li><li><div><strong>Собери разговор.</strong><span>Когда эмоции немного улягутся, обсуди, что произошло и что каждый из вас хочет дальше.</span></div></li><li><div><strong>Прими решение из позиции силы.</strong><span>Остаться или уйти — твоё решение, а не реакция на боль.</span></div></li></ol></section></div></article><aside className="article-aside"><p className="aside-title">В этой статье</p><nav><a href="#first-weeks">Что происходит в первые недели</a><a href="#mistakes">Какие действия только ухудшают ситуацию</a><a href="#steps">Порядок действий</a></nav><div className="aside-note"><span>01</span><p>Читай в своём темпе. Тебе не нужно принять решение за один вечер.</p></div></aside></div><WebinarBand compact articleId="article_0001" topic="izmena" /><section className="related shell section-space"><div className="section-heading section-heading--line"><h2>Ещё по теме</h2></div><div className="related-grid">{relatedArticles.map((article) => <Link href="/articles/" className="related-card" key={article.title}><h3>{article.title}</h3><p>{article.time}</p><span>→</span></Link>)}</div></section></main><Footer /></>;
}

function ArticleStubPage({ title }) { return <><main><PageIntro breadcrumbs={[{ label: 'Статьи', href: '/articles/' }, { label: title }]} title={title} lead="Материал входит в очередь подготовки и появится после проверки источников, структуры и редакционных ограничений." /><section className="archive-placeholder shell section-space"><div><p className="section-label">Статус материала</p><h2>Готовим самостоятельный ответ</h2><p>Каждая публикация должна отвечать на конкретный запрос, опираться на подтверждённые материалы и проходить ручную проверку на старте проекта.</p></div><ArrowLink href="/webinar/">Пока посмотреть вебинар</ArrowLink></section></main><Footer /></>; }

function TopicPage() { return <><main className="topic-page"><section className="topic-hero shell"><Breadcrumbs items={[{ label: 'Темы', href: '/topics/' }, { label: 'Измена жены' }]} /><h1>Измена жены</h1><p>Что делать, если после измены ты не понимаешь, как разговаривать, жить дальше и принимать решения?</p><hr /><span>Здесь собраны материалы, которые помогут понять, что происходит, и выбрать путь без лишней суеты и саморазрушения.</span></section><section className="topic-materials shell section-space"><div className="topic-materials__list"><div className="section-heading"><h2>Материалы по теме</h2></div>{topicArticles.map((article, index) => <Link href={article.href} className="topic-article" key={article.href}><span className="topic-article__number">0{index + 1}</span><div><h3>{article.title}</h3><p>{article.description}</p></div><span className="topic-article__time">{article.time}</span></Link>)}</div><div className="topic-start"><p className="section-label">Три первых шага</p><h2>Начни отсюда</h2><ol><li><span>01</span><div><strong>Остановить действия из паники</strong><p>Дай себе паузу. Не спеши с решениями и резкими шагами.</p></div></li><li><span>02</span><div><strong>Разобраться в происходящем</strong><p>Пойми, что произошло на самом деле, собери факты и свои мысли.</p></div></li><li><span>03</span><div><strong>Выбрать следующий разговор</strong><p>Подготовь спокойный и честный разговор, который даст ясность.</p></div></li></ol></div></section><section className="topic-case"><div className="shell topic-case__inner"><p className="section-label">Случаи из практики</p><div><h2>Раздел будет пополняться после проверки материалов</h2><p>Сырые истории не публикуются. Для каждого случая детали обобщаются, чувствительные сведения удаляются, а публикация отдельно подтверждается.</p></div><ArrowLink href="/cases/">Открыть раздел</ArrowLink></div></section><WebinarBand articleId="topic_izmena" topic="izmena" /></main><Footer /></>; }

function TopicCollectionPage({ topicSlug }) {
  const topic = allTopics.find((item) => item.slug === topicSlug) || allTopics[0];
  const articles = getTopicArticles(topicSlug);
  return <><main className="topic-page"><section className="topic-hero shell"><Breadcrumbs items={[{ label: 'Темы', href: '/topics/' }, { label: topic.title }]} /><h1>{topic.title}</h1><p>{topic.description}</p><hr /><span>Здесь собраны материалы, которые помогают увидеть ситуацию яснее и выбрать следующий шаг без лишнего давления.</span></section><section className="topic-materials shell section-space"><div className="topic-materials__list"><div className="section-heading"><h2>Материалы по теме</h2></div>{articles.map((article, index) => <Link href={article.href} className="topic-article" key={article.href}><span className="topic-article__number">0{index + 1}</span><div><h3>{article.title}</h3><p>{article.description}</p></div><span className="topic-article__time">{article.time}</span></Link>)}</div><div className="topic-start"><p className="section-label">Как читать раздел</p><h2>Сначала — ближайший шаг</h2><ol><li><span>01</span><div><strong>Остановить импульс</strong><p>Не принимай важное решение в момент, когда тобой управляет страх или злость.</p></div></li><li><span>02</span><div><strong>Отделить факты</strong><p>Раздели происходящее, свои догадки и действия, которые зависят от тебя.</p></div></li><li><span>03</span><div><strong>Выбрать разговор</strong><p>Сформулируй следующий вопрос или границу так, чтобы их можно было выполнить.</p></div></li></ol></div></section><section className="topic-case"><div className="shell topic-case__inner"><p className="section-label">Случаи из практики</p><div><h2>Раздел будет пополняться после проверки материалов</h2><p>Обезличенные случаи публикуются отдельно после ручной проверки конфиденциальности и разрешения на использование.</p></div><ArrowLink href="/cases/">Открыть раздел</ArrowLink></div></section><WebinarBand articleId={`topic_${topicSlug}`} topic={topicSlug} /></main><Footer /></>;
}

function TopicStubPage({ topic }) { return <><main><PageIntro breadcrumbs={[{ label: 'Темы', href: '/topics/' }, { label: topic.title }]} title={topic.title} lead={topic.description} /><section className="archive-placeholder shell section-space"><div><p className="section-label">Раздел в каркасе</p><h2>Собираем материалы по теме</h2><p>Здесь появятся опорная страница, узкие статьи и связанные обезличенные случаи после проверки источников.</p></div><ArrowLink href="/articles/">Перейти к статьям</ArrowLink></section></main><Footer /></>; }

function TopicsIndexPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Темы' }]} title="Темы" lead="Выбери ситуацию, которая сейчас ближе всего к тебе. Каждый раздел будет отвечать на конкретные вопросы и вести к связанным материалам." /><section className="topic-directory shell section-space"><div className="section-heading section-heading--line"><h2>Направления</h2></div>{allTopics.map((topic, index) => <Link href={`/topics/${topic.slug}/`} className="directory-row" key={topic.slug}><span>0{index + 1}</span><div><h3>{topic.title}</h3><p>{topic.description}</p></div><b>→</b></Link>)}</section></main><Footer /></>; }

function ArticlesIndexPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Статьи' }]} title="Все статьи" lead="Материалы о кризисах в отношениях, измене, разводе, ревности и возвращении уверенности — с прямым ответом в начале каждой статьи." /><section className="archive-layout shell section-space"><div className="archive-list"><div className="section-heading section-heading--line"><h2>Новые и опорные материалы</h2></div>{articleCards.map((article, index) => <Link href={article.href} className="archive-row" key={article.href}><span className="archive-row__number">0{index + 1}</span><div><h3>{article.title}</h3><p>{article.description}</p></div><span className="archive-row__time">{article.time}</span></Link>)}</div><aside className="archive-aside"><p className="section-label">Навигация по темам</p><h2>С чего начать</h2>{topicLinks.map((topic) => <Link href={topic.href} key={topic.href}>{topic.label}<span>→</span></Link>)}<div className="archive-aside__note">Статьи готовятся как самостоятельные ответы, а не только ради поисковой фразы.</div></aside></section><WebinarBand articleId="articles" topic="overview" /></main><Footer /></>; }

function CasesIndexPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Случаи' }]} title="Случаи из практики" lead="Здесь будут обезличенные примеры ситуаций, решений и изменений. Публикация каждого материала проходит отдельную проверку." /><section className="cases-template shell section-space"><div className="cases-template__intro"><p className="section-label">Правило публикации</p><h2>Сначала конфиденциальность</h2><p>Имена, города, даты, профессии и другие узнаваемые детали не переносятся в публикацию. Результат указывается только если он подтверждён и разрешён к использованию.</p></div><div className="cases-template__steps"><div><span>01</span><h3>Ситуация</h3><p>Что произошло и с каким вопросом мужчина пришёл.</p></div><div><span>02</span><h3>Решения</h3><p>Какие действия помогали вернуть ясность и границы.</p></div><div><span>03</span><h3>Изменения</h3><p>Только зафиксированные и разрешённые результаты.</p></div></div></section><section className="empty-band"><div className="shell"><p className="section-label">Сейчас в разделе</p><h2>Первые материалы проходят подготовку</h2><p>Раздел уже предусмотрен в структуре сайта. Публикация начнётся после ручного подтверждения первых случаев.</p></div></section><WebinarBand articleId="cases" topic="cases" /></main><Footer /></>; }

function AboutPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Об авторе' }]} title="Георгий Соколовский — ментор для мужчин" lead="Помогаю мужчинам выйти из кризиса после измены, предательства или развода и снова стать уверенными в себе." /><section className="profile-section shell section-space"><div className="profile-photo"><img src={portraitPath} alt="Георгий Соколовский" /></div><div className="profile-copy"><p className="section-label">Почему я занимаюсь этим</p><h2>В кризисе легко потерять управление своей жизнью</h2><p>Я работаю с мужчинами, которые столкнулись с изменой супруги, угрозой развода, потерей семьи, обесцениванием, ревностью или ощущением, что после многих лет брака исчезла привычная опора.</p><p>До помогающей практики я занимался бизнесом, управлял ночным клубом, прошёл выгорание и переезд из Украины в Испанию. Поэтому в работе учитываю не только разговоры об отношениях, но и семью, детей, финансовые обязательства и давление реальной жизни.</p></div></section><section className="profile-band"><div className="shell profile-band__inner"><div><p className="section-label">Моя задача в работе</p><h2>Вернуть мужчине возможность спокойно думать, говорить и выбирать</h2></div><p>Мы разбираем эмоциональные реакции, прошлый опыт, повторяющиеся сценарии и решения, которые принимаются в кризисном состоянии. Конкретный исход отношений заранее не обещается.</p></div></section><WebinarBand articleId="about" topic="overview" /></main><Footer /></>; }

function MethodPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Подход' }]} title="Подход к работе" lead="Разбираем не только то, что делает партнёрша. Смотрим, что происходит с тобой, какие действия усиливают проблему и какое решение ты действительно готов принять." /><section className="method-grid shell section-space"><div className="method-intro"><p className="section-label">Как устроена работа</p><h2>От реакции — к ясному решению</h2><p>Цель работы — вернуть управление своими действиями, снизить эмоциональную реактивность, выстроить личные границы и спокойнее увидеть будущее отношений.</p></div><div className="method-list"><div><span>01</span><div><h3>Состояние</h3><p>Замечаем, что происходит с тобой в момент боли, страха или унижения.</p></div></div><div><span>02</span><div><h3>Сценарии</h3><p>Разбираем повторяющиеся реакции и установки, которые влияют на решения.</p></div></div><div><span>03</span><div><h3>Действия</h3><p>Отделяем импульсивные шаги от того, что возвращает тебе опору и границы.</p></div></div><div><span>04</span><div><h3>Разговор</h3><p>Готовимся к сложному разговору и выбираем следующий шаг без обещаний за другого человека.</p></div></div></div></section><section className="method-note shell"><p>После работы мужчина может решить восстанавливать текущие отношения, завершать их или строить новые. Конкретный исход заранее не гарантируется.</p></section><WebinarBand articleId="method" topic="overview" /></main><Footer /></>; }

function WebinarPage() { return <><main><PageIntro dark breadcrumbs={[{ label: 'Бесплатный вебинар' }]} title="3 шага как стать мужчиной, с которым считаются, ценят и боятся потерять" lead="Мужской разговор примерно на 90 минут о состоянии, повторяющихся сценариях и решениях, которые можно принимать из большей ясности."><WebinarLink placement="webinar" articleId="webinar" topic="overview">Зарегистрироваться</WebinarLink></PageIntro><section className="webinar-detail shell section-space"><div className="webinar-detail__intro"><p className="section-label">Что внутри</p><h2>Три шага, чтобы вернуть себе управление</h2><p>Вебинар начинается с узнаваемых ситуаций, а затем переводит разговор к тому, что мужчина может менять в своих реакциях и действиях.</p></div><div className="webinar-steps"><div><span>01</span><h3>Освободиться от ограничивающих сценариев</h3><p>Увидеть, как прошлый опыт и привычные реакции влияют на решения.</p></div><div><span>02</span><h3>Переписать внутренние установки</h3><p>Найти новые способы реагировать, разговаривать и держать границы.</p></div><div><span>03</span><h3>Строить отношения из мужской силы</h3><p>Принимать решения не из страха потери, а из понимания своих ценностей и выбора.</p></div></div></section></main><Footer /></>; }

function ContactsPage() { return <><main><PageIntro breadcrumbs={[{ label: 'Контакты' }]} title="Контакты" lead="По вопросам вебинара и дальнейшей работы начни с регистрации на бесплатный разговор." /><section className="contact-section shell section-space"><div><p className="section-label">Следующий шаг</p><h2>Сначала разберись в своей ситуации</h2><p>Регистрация проходит на существующей странице проекта. После заявки помощник уточняет ситуацию и возможный формат дальнейшей работы.</p><WebinarLink placement="contacts" articleId="contacts" topic="overview">Перейти к регистрации</WebinarLink></div><div className="contact-note"><span>Важно</span><p>На этом этапе сайт не собирает собственные заявки и не просит вводить здесь имя, телефон или почту.</p></div></section></main><Footer /></>; }

function LegalPage({ title, description }) { return <><main><PageIntro breadcrumbs={[{ label: 'Документы' }, { label: title }]} title={title} lead={description} /><section className="legal-placeholder shell section-space"><div className="legal-placeholder__mark">i</div><div><p className="section-label">Страница в каркасе</p><h2>Текст готовится к юридической проверке</h2><p>Перед публичным запуском здесь должны появиться актуальные условия для владельца сайта, региона аудитории и используемых сервисов. До проверки этот раздел не считается финальной юридической публикацией.</p></div></section></main><Footer /></>; }

function SkeletonPage({ title, description, label = 'Раздел сайта' }) { return <><main className="skeleton-page shell"><Breadcrumbs items={[{ label: 'Главная', href: '/' }, { label: title }]} /><p className="section-label">{label}</p><h1>{title}</h1><p className="skeleton-page__lead">{description}</p><div className="skeleton-page__rule" /><div className="skeleton-page__grid"><div><h2>Страница в первом каркасе</h2><p>Здесь будет содержательный раздел проекта. Визуальный язык, навигация и переход на вебинар уже собраны в прототипе.</p></div><WebinarLink placement="skeleton" articleId="skeleton" topic="overview">Перейти к вебинару</WebinarLink></div></main><Footer /></>; }

function NotFoundPage() { return <SkeletonPage title="Страница не найдена" description="Проверь адрес или вернись на главную страницу проекта." label="404" />; }

function WebinarRedirectPage() {
  useEffect(() => {
    const robots = document.querySelector('meta[name="robots"]');
    robots?.setAttribute('content', 'noindex, nofollow');
    const target = new URL(webinarTarget);
    const params = readWebinarParams();
    Object.keys(defaultWebinarParams).forEach((key) => { if (!params.has(key)) params.set(key, defaultWebinarParams[key]); });
    recordWebinarClick(params);
    params.forEach((value, key) => target.searchParams.set(key, value));
    window.location.replace(target.toString());
  }, []);
  return <main className="redirect-page"><div className="redirect-page__mark">PRO Мужчин</div><h1>Переходим на страницу вебинара…</h1><p>Источник перехода сохранён в адресе регистрации.</p></main>;
}

function RouteMeta({ path }) {
  const article = approvedArticles[path.split('/')[2]];
  const topic = allTopics.find((item) => path.startsWith(`/topics/${item.slug}`));
  useEffect(() => {
    const titles = { '/': 'PRO Мужчин — когда отношения рушатся, важно не потерять себя', '/about/': 'Об авторе — PRO Мужчин', '/method/': 'Подход к работе — PRO Мужчин', '/webinar/': 'Бесплатный вебинар — PRO Мужчин', '/articles/': 'Все статьи — PRO Мужчин', '/cases/': 'Случаи из практики — PRO Мужчин', '/contacts/': 'Контакты — PRO Мужчин', '/topics/': 'Темы — PRO Мужчин' };
    const pageTitle = article ? `${article.title} — PRO Мужчин` : topic ? `${topic.title} — PRO Мужчин` : titles[path] || 'PRO Мужчин';
    const pageDescription = article?.description || topic?.description || 'PRO Мужчин — авторский ресурс для мужчин в кризисе отношений.';
    document.title = pageTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', pageDescription);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogImage = document.querySelector('meta[property="og:image"]');
    ogTitle?.setAttribute('content', pageTitle);
    ogDescription?.setAttribute('content', pageDescription);
    ogImage?.setAttribute('content', article ? `${window.location.origin}/images/social/${article.id}-social.svg` : '');
  }, [path, article, topic]);
  return null;
}

function App() {
  const path = usePath();
  if (path === '/go/webinar') return <WebinarRedirectPage />;
  const articleSlug = path.split('/')[2];
  if (path.startsWith('/articles/') && approvedArticleSlugs.includes(articleSlug)) return <><RouteMeta path={path} /><Header /><ApprovedArticlePage slug={articleSlug} /></>;
  if (path.startsWith('/topics/razvod')) return <><RouteMeta path={path} /><Header /><TopicCollectionPage topicSlug="razvod" /></>;
  if (path.startsWith('/topics/vozvrashchenie')) return <><RouteMeta path={path} /><Header /><TopicCollectionPage topicSlug="vozvrashchenie" /></>;
  if (path.startsWith('/topics/revnost')) return <><RouteMeta path={path} /><Header /><TopicCollectionPage topicSlug="revnost" /></>;
  if (path.startsWith('/topics/deti-posle-razvoda')) return <><RouteMeta path={path} /><Header /><TopicCollectionPage topicSlug="deti-posle-razvoda" /></>;
  const route = <><RouteMeta path={path} />{path === '/' || path === '' ? <><Header /><HomePage /></> : null}{path === '/articles/' || path === '/articles' ? <><Header /><ArticlesIndexPage /></> : null}{path.startsWith('/articles/') && path !== '/articles/' && path !== '/articles' && !path.includes('/articles/kak-perezhit-izmenu-zheny/') ? <><Header /><ArticleStubPage title={articleTitles[path.split('/')[2]] || 'Материал по теме'} /></> : null}{path.startsWith('/articles/kak-perezhit-izmenu-zheny/') ? <><Header /><ArticlePage /></> : null}{path === '/topics/' || path === '/topics' ? <><Header /><TopicsIndexPage /></> : null}{path.startsWith('/topics/izmena-zheny') ? <><Header /><TopicPage /></> : null}{path.startsWith('/topics/') && !path.startsWith('/topics/izmena-zheny') && path !== '/topics/' && path !== '/topics' ? <><Header /><TopicStubPage topic={allTopics.find((item) => path.includes(`/${item.slug}`)) || allTopics[0]} /></> : null}{path === '/cases/' || path === '/cases' || path.startsWith('/cases/') ? <><Header /><CasesIndexPage /></> : null}{path === '/about/' || path === '/about' ? <><Header /><AboutPage /></> : null}{path === '/method/' || path === '/method' ? <><Header /><MethodPage /></> : null}{path === '/webinar/' || path === '/webinar' ? <><Header /><WebinarPage /></> : null}{path === '/contacts/' || path === '/contacts' ? <><Header /><ContactsPage /></> : null}{legalPaths.includes(path) ? <><Header /><LegalPage title={path.includes('privacy') ? 'Политика конфиденциальности' : path.includes('cookie') ? 'Политика использования файлов cookie' : path.includes('consent') ? 'Согласие на обработку персональных данных' : path.includes('boundaries') ? 'Границы информации на сайте' : 'Редакционная политика'} description="Правила сайта и использования материалов проекта." /></> : null}</>;
  const known = path === '/' || path === '' || path === '/articles/' || path === '/articles' || path.startsWith('/articles/') || path === '/topics/' || path === '/topics' || path.startsWith('/topics/') || path === '/cases/' || path === '/cases' || path.startsWith('/cases/') || path === '/about/' || path === '/about' || path === '/method/' || path === '/method' || path === '/webinar/' || path === '/webinar' || path === '/contacts/' || path === '/contacts' || legalPaths.includes(path);
  return known ? route : <><Header /><NotFoundPage /></>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
