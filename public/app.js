'use strict';
const $ = selector => document.querySelector(selector);
const icons = {
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
 search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
 bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/>',
 plus:'<path d="M12 4v16M4 12h16"/>',
 pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
 gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8C3 9 4 1 8 3c3 1 4 5 4 5s1-4 4-5c4-2 5 6-4 5Z"/>',
 people:'<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 3a3 3 0 0 1 0 6m2 4a5 5 0 0 1 4 5v3"/>',
 chat:'<path d="M21 11a9 9 0 0 1-9 9H6l-4 2 1-6a9 9 0 1 1 18-5Z"/><path d="M7 11h.1m4.9 0h.1m4.9 0h.1"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
 profile:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-2a8 8 0 0 1 16 0v2"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 back:'<path d="m14 5-7 7 7 7"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.calendar}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage = {get(key){try{return localStorage.getItem(key)}catch{return null}},set(key,value){try{localStorage.setItem(key,value);return true}catch{return false}},remove(key){try{localStorage.removeItem(key)}catch{}}};

const wishlistCovers = ['gift', 'birthday', 'travel', 'home'];
const wishlistCoverLabels = {gift:'Подарки',birthday:'День рождения',travel:'Путешествие',home:'Для дома'};
const wishlistCoverEmoji = {birthday:'🎂',travel:'✈️',home:'🏡'};
let wishlists = [];
try {
 const value = JSON.parse(storage.get('fe-wishlists-v1') || '[]');
 if (Array.isArray(value)) wishlists = value.filter(w => w && typeof w.id === 'string' && typeof w.title === 'string' && w.title.trim() && w.title.length <= 60 && ['link','private'].includes(w.access)).map(w => ({...w,description:typeof w.description==='string'?w.description.slice(0,300):'',cover:wishlistCovers.includes(w.cover)?w.cover:'gift',items:Array.isArray(w.items)?w.items.filter(i=>i&&typeof i.title==='string').map(i=>({title:i.title.slice(0,100)})):[]}));
} catch {}
let wishlistDraft = {title:'',description:'',access:'link',cover:'gift'};
const wishlistAsset = name => `assets/wishlist/${name}.svg`;
function wishlistCoverArt(cover){return cover==='gift'?`<img class="wishlist-gift" src="${wishlistAsset('gift')}" width="52" height="52" alt="">`:`<span class="wishlist-cover-emoji" aria-hidden="true">${wishlistCoverEmoji[cover]||'🎁'}</span>`}
function renderWishlists(){
 $('#page').innerHTML=`<div class="title-row"><h1>Списки желаний</h1><button class="primary" data-action="wishlist">${icon('plus')}Создать вишлист</button></div><p class="muted">Сохраняйте идеи подарков и делитесь ими с близкими.</p>${wishlists.length?`<div class="wishlist-list">${wishlists.map(w=>`<button class="panel wishlist-card" data-wishlist="${esc(w.id)}"><div class="wishlist-card-art">${wishlistCoverArt(w.cover)}</div><div><h2>${esc(w.title)}</h2><p class="muted">${w.items.length} желаний · ${w.access==='private'?'Только я':'По ссылке'}</p>${w.description?`<p>${esc(w.description)}</p>`:''}</div>${icon('chevron')}</button>`).join('')}</div>`:`<div class="panel empty">${icon('gift')}<h2>Какие у вас желания?</h2><p>Создайте список для праздника или сохраните идеи для себя.</p><button class="primary" data-action="wishlist">Создать первый вишлист</button></div>`}<p class="demo-note">Вишлисты хранятся в этом браузере. Общий доступ пока не подключён.</p>`;
}
function renderWishlistCreate(){
 const w=wishlistDraft;
 $('#page').innerHTML=`<section class="wishlist-create"><div class="wishlist-navigation"><button type="button" class="wishlist-back" data-route="wishlist" aria-label="Вернуться к вишлистам"><img src="${wishlistAsset('back')}" width="20" height="20" alt=""></button><span>МОИ ВИШЛИСТЫ</span></div><h1>Новый вишлист</h1><p class="wishlist-intro">Соберите желания, чтобы близким было проще выбрать подарок.</p><form id="wishlist-form"><div class="wishlist-cover" data-cover="${w.cover}" role="group" aria-label="Обложка: ${wishlistCoverLabels[w.cover]}"><img class="wishlist-ring wishlist-ring-left" src="${wishlistAsset('ring-left')}" width="160" height="160" alt=""><img class="wishlist-ring wishlist-ring-right" src="${wishlistAsset('ring-right')}" width="210" height="210" alt=""><div id="wishlist-cover-art">${wishlistCoverArt(w.cover)}</div><button type="button" class="wishlist-cover-change" data-action="wishlist-cover">Сменить обложку</button></div><div class="wishlist-field"><div class="wishlist-label"><label for="wishlist-title">Название</label><span id="wishlist-count">${w.title.length} / 60</span></div><input id="wishlist-title" name="title" required maxlength="60" autocomplete="off" placeholder="Например, на день рождения" value="${esc(w.title)}"></div><div class="wishlist-field wishlist-description"><div class="wishlist-label"><label for="wishlist-description">Описание</label><span>Необязательно</span></div><textarea id="wishlist-description" name="description" maxlength="300" placeholder="Пара слов для тех, кто выбирает подарок">${esc(w.description)}</textarea></div><fieldset class="wishlist-access"><legend>Кто может смотреть</legend>${[['link','По ссылке','Поделитесь с друзьями и близкими'],['private','Только я','Личный список, который видите только вы']].map(([value,title,hint])=>`<label class="wishlist-access-option"><img src="${wishlistAsset(value==='link'?'link':'lock')}" width="20" height="20" alt=""><span><strong>${title}</strong><small>${hint}</small></span><input type="radio" name="access" value="${value}" ${w.access===value?'checked':''}><span class="wishlist-radio-art" aria-hidden="true"><img class="wishlist-radio-empty" src="${wishlistAsset('radio')}" width="17" height="17" alt=""><img class="wishlist-radio-selected" src="${wishlistAsset('radio-selected')}" width="17" height="17" alt=""><img class="wishlist-radio-dot" src="${wishlistAsset('radio-dot')}" width="7" height="7" alt=""></span></label>`).join('')}</fieldset><button class="primary wishlist-submit" type="submit" ${!w.title.trim()?'disabled':''}>Создать вишлист</button><p class="wishlist-next">Желания можно добавить на следующем шаге</p><p class="wishlist-local">Пока список доступен только в этом браузере.<br>Выбранный режим доступа сохранится на будущее.</p></form></section>`;
}
function renderWishlistDetail(){
 const id=location.hash.slice('#wishlist/'.length);const w=wishlists.find(w=>w.id===id);
 if(!w){$('#page').innerHTML=`<div class="panel empty"><h1>Вишлист не найден</h1><p>Возможно, он создан в другом браузере.</p><button class="primary" data-route="wishlist">Мои вишлисты</button></div>`;return;}
 $('#page').innerHTML=`<button class="secondary" data-route="wishlist">${icon('back')}Мои вишлисты</button><div class="wishlist-detail-cover">${wishlistCoverArt(w.cover)}</div><h1 class="wishlist-detail-title">${esc(w.title)}</h1>${w.description?`<p>${esc(w.description)}</p>`:''}<p class="muted">${w.access==='private'?'Только я':'Доступ по ссылке выбран · общий доступ пока не подключён'}</p>${w.items.length?`<div class="panel">${w.items.map(i=>`<div class="notice">${esc(i.title)}</div>`).join('')}</div>`:`<div class="panel empty"><h2>Вишлист готов</h2><p>Добавьте первое желание, чтобы близкие знали, что вас порадует.</p></div>`}<form id="wish-item-form" class="panel wish-item-form" data-id="${esc(w.id)}"><label for="wish-item-title">Новое желание</label><input id="wish-item-title" name="title" required maxlength="100" placeholder="Например, книга или билеты в театр"><button class="primary" type="submit">${icon('plus')}Добавить желание</button></form><p class="demo-note">Список и желания сохраняются только в этом браузере.</p>`;
}
function saveWishlist(){
 const form=$('#wishlist-form');const title=form.elements.title.value.trim();
 if(!title){form.elements.title.setCustomValidity('Введите название вишлиста');form.elements.title.reportValidity();return;}
 if(!form.reportValidity())return;
 const w={id:'wishlist-'+(window.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)),title,description:form.elements.description.value.trim(),access:form.elements.access.value,cover:wishlistDraft.cover,items:[]};
 wishlists.unshift(w);const stored=storage.set('fe-wishlists-v1',JSON.stringify(wishlists));wishlistDraft={title:'',description:'',access:'link',cover:'gift'};navigate('wishlist/'+w.id);toast(stored?'Вишлист создан':'Вишлист создан на время сеанса: сохранение недоступно');
}
function saveWishItem(form){const title=form.elements.title.value.trim();if(!title){form.elements.title.setCustomValidity('Введите желание');form.elements.title.reportValidity();return;}const w=wishlists.find(w=>w.id===form.dataset.id);if(!w)return;w.items.push({title});const stored=storage.set('fe-wishlists-v1',JSON.stringify(wishlists));render();toast(stored?'Желание добавлено':'Желание добавлено на время сеанса: сохранение недоступно');}

const tg = window.Telegram?.WebApp;
const telegramUser = tg?.initData ? tg.initDataUnsafe?.user : null;
if(tg){try{tg.ready();tg.expand()}catch{}}
let signedIn = !!telegramUser || storage.get('fe-demo-login') === '1';
const seeds = [
 {id:'anna',title:'День рождения Анны',date:'2026-09-27',time:'18:00',place:'Ресторан «La Prima»',address:'ул. Остоженка, 12, Москва',art:'birthday',people:12},
 {id:'sochi',title:'Поездка в Сочи',date:'2026-10-05',time:'',place:'Сочи',art:'sochi',people:7},
 {id:'halloween',title:'Хэллоуин у нас дома',date:'2026-10-31',time:'18:00',place:'Дом, Москва',art:'halloween',people:10},
 {id:'ski',title:'Горнолыжный уикенд',date:'2026-12-14',time:'09:00',place:'Красная Поляна',art:'ski',people:8},
 {id:'newyear',title:'Новый год 2027',date:'2026-12-31',time:'20:00',place:'Загородный дом',art:'newyear',people:11},
 {id:'picnic',title:'Семейный пикник',date:'2026-08-15',time:'12:00',place:'Парк, Москва',art:'custom',people:6},
 {id:'draft1',title:'Семейный ужин',date:'',time:'',place:'Место ещё не выбрано',art:'custom',people:1,draft:true},
 {id:'draft2',title:'Годовщина свадьбы',date:'',time:'',place:'Место ещё не выбрано',art:'custom',people:1,draft:true}
];
let saved = [];
try{const value=JSON.parse(storage.get('fe-events-v1')||'[]');if(Array.isArray(value))saved=value.filter(e=>e&&typeof e.id==='string'&&typeof e.title==='string'&&typeof e.date==='string'&&(!e.date||/^\d{4}-\d{2}-\d{2}$/.test(e.date)))}catch{}
let events = seeds.map(e=>({...e,...saved.find(s=>s.id===e.id)})).concat(saved.filter(e=>!seeds.some(s=>s.id===e.id)));
let activeTab='upcoming', query='', searchOpen=false, toastTimer;
const today = new Date(); today.setHours(0,0,0,0);
const eventDate = e => new Date(`${e.date}T${e.time || '23:59'}:00`);
const category = e => e.draft?'drafts':eventDate(e)<today?'past':'upcoming';
const byCategory = tab => events.filter(e=>category(e)===tab).sort((a,b)=>tab==='past'?eventDate(b)-eventDate(a):eventDate(a)-eventDate(b));
function dateText(e){if(!e.date)return 'Дата ещё не выбрана';return new Intl.DateTimeFormat('ru',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(eventDate(e)).replace(' г.','')+' · '+(e.time||'Весь день')}
function people(e){return `<div class="people" aria-label="${Number(e.people)||1} участников">${['АН','МС','ДК','ЕЛ'].slice(0,Math.min(Number(e.people)||1,4)).map(n=>`<span class="person" aria-hidden="true">${n}</span>`).join('')}${e.people>4?`<span class="more-people">+${e.people-4}</span>`:''}</div>`}
const crops={birthday:'175 449 225 140',sochi:'260 743 83 146',halloween:'260 913 83 146',ski:'260 1081 83 146',newyear:'260 1249 83 146'};
function cover(e,featured){
 let badge='';
 if(e.date){const d=eventDate(e);const days=Math.round((new Date(e.date+'T00:00:00')-today)/86400000);badge=featured?`<span class="soon">${days===0?'Сегодня':days===1?'Завтра':`Через ${days} ${days%10===1&&days%100!==11?'день':days%10>=2&&days%10<=4&&(days%100<12||days%100>14)?'дня':'дней'}`}</span>`:`<span class="date-badge"><b>${d.getDate()}</b>${new Intl.DateTimeFormat('ru',{month:'short'}).format(d).replace('.','')}</span>`}
 return `<div class="cover ${crops[e.art]?'':'custom'}">${crops[e.art]?`<svg class="cover-image" viewBox="${crops[e.art]}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><image href="assets/home-reference.png" width="1024" height="1536"/></svg>`:'♡'}${badge}</div>`;
}
function card(e,featured=false){return `<article class="${featured?'featured':'event-row'}"><button class="event-open" data-event="${esc(e.id)}" aria-label="${e.draft?'Редактировать':'Открыть'}: ${esc(e.title)}">${cover(e,featured)}<div class="event-info"><h3>${esc(e.title)}</h3><div class="meta">${icon('calendar')}<span>${esc(dateText(e))}</span></div><div class="meta">${icon('pin')}<span>${esc(e.place)}</span></div>${featured&&e.address?`<span class="address">${esc(e.address)}</span>`:''}${people(e)}</div><span class="chevron">${icon('chevron')}</span></button>${featured?`<div class="quick-actions">${[['chat','Чат'],['gift','Список подарков'],['people','Участники'],['info','Детали']].map(([action,label])=>`<button class="secondary" data-detail="${action}" data-id="${esc(e.id)}">${icon(action)}${label}</button>`).join('')}</div>`:''}</article>`}
function empty(title,text,create=false){return `<div class="panel empty">${icon('calendar')}<h2>${title}</h2><p>${text}</p>${create?`<button class="primary" data-action="create">${icon('plus')}Создать событие</button>`:''}</div>`}
function renderEvents(){
 const filtered=byCategory(activeTab).filter(e=>(e.title+' '+e.place).toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
 let content='';
 if(!filtered.length)content=empty(query?'Ничего не найдено':activeTab==='past'?'Пока нет прошедших событий':activeTab==='drafts'?'Нет черновиков':'Пока нет событий',query?'Попробуйте другое название или место.':'Самое время запланировать встречу с близкими.',!query);
 else if(activeTab==='upcoming'&&!query)content=`<h2>Ближайшее событие</h2>${card(filtered[0],true)}${filtered.length>1?`<h2 class="section-title">Все предстоящие</h2><div class="event-list">${filtered.slice(1).map(e=>card(e)).join('')}</div>`:''}`;
 else content=`<div class="event-list">${filtered.map(e=>card(e)).join('')}</div>`;
 $('#event-results').innerHTML=content;
}
function route(){const hash=location.hash.slice(1);return hash.startsWith('wishlist/')?'wishlist-detail':['events','calendar','wishlist','wishlist-new','profile'].includes(hash)?hash:'events'}
function navigate(name){if(location.hash.slice(1)===name)render();else location.hash=name}
function render(){
 $('#login').hidden=signedIn;$('#home').hidden=!signedIn;if(!signedIn)return;
 const current=route();
 $('#home').classList.toggle('wishlist-editor',current==='wishlist-new');
 const navRoute=current.startsWith('wishlist')?'wishlist':current;
 $('#avatar').textContent=(telegramUser?.first_name||'А').charAt(0).toUpperCase();
 $('#search-toggle').innerHTML=icon('search');$('#notifications-toggle').innerHTML=icon('bell')+'<span class="badge">3</span>';
 $('.bottom-nav').innerHTML=[['events','calendar','Мои события'],['calendar','calendar','Календарь'],['create','plus','Создать событие'],['wishlist','gift','Вишлисты'],['profile','profile','Профиль']].map(([r,i,label])=>r==='create'?`<button class="nav-create" data-action="create" aria-label="${label}">${icon(i)}</button>`:`<button class="nav-item ${navRoute===r?'active':''}" data-route="${r}" ${navRoute===r?'aria-current="page"':''}>${icon(i)}<span>${label}</span></button>`).join('');
 if(current==='events'){
 $('#page').innerHTML=`<div class="title-row"><h1>Мои события</h1><button class="primary" data-action="create">${icon('plus')}Создать событие</button></div>${searchOpen?`<div class="search">${icon('search')}<input type="search" id="search" aria-label="Название или место события" placeholder="Название или место" value="${esc(query)}"><button class="icon-button" data-action="clear-search" aria-label="Закрыть поиск">×</button></div>`:''}<div class="tabs" role="tablist" aria-label="Период событий">${[['upcoming','Предстоящие'],['past','Прошедшие'],['drafts','Черновики']].map(([t,label])=>`<button role="tab" id="tab-${t}" aria-controls="event-results" aria-selected="${activeTab===t}" tabindex="${activeTab===t?'0':'-1'}" class="tab ${activeTab===t?'active':''}" data-tab="${t}">${label}<span class="count">${byCategory(t).length}</span></button>`).join('')}</div><div id="event-results" role="tabpanel" aria-labelledby="tab-${activeTab}" aria-live="polite"></div><p class="demo-note">Демо-события · новые события сохраняются в этом браузере</p>`;renderEvents();
 }else if(current==='calendar'){
 const list=events.filter(e=>!e.draft).sort((a,b)=>eventDate(a)-eventDate(b));
 $('#page').innerHTML='<div class="title-row"><h1>Календарь</h1><button class="primary" data-action="create">'+icon('plus')+'Создать событие</button></div><p class="muted">Все семейные планы по датам</p>'+list.map(e=>`<h2 class="calendar-date">${esc(dateText(e))}</h2>${card(e)}`).join('');
 }else if(current==='wishlist')renderWishlists();
 else if(current==='wishlist-new')renderWishlistCreate();
 else if(current==='wishlist-detail')renderWishlistDetail();
 else $('#page').innerHTML=`<div class="title-row"><h1>Профиль</h1></div><div class="panel profile-card"><div class="avatar">${esc((telegramUser?.first_name||'А').charAt(0))}</div><h2>${esc(telegramUser?[telegramUser.first_name,telegramUser.last_name].filter(Boolean).join(' '):'Демо-профиль')}</h2><p class="muted">${telegramUser?'Профиль Telegram подключён':'Войдите через Telegram, чтобы увидеть свой профиль.'}</p>${telegramUser?`<p class="muted">Telegram ID ${esc(telegramUser.id)}</p>`:`<button class="secondary" data-action="logout">Выйти из прототипа</button>`}</div>`;
 document.title='Family Events — '+({events:'Мои события',calendar:'Календарь',wishlist:'Списки желаний','wishlist-new':'Новый вишлист','wishlist-detail':'Вишлист',profile:'Профиль'}[current]);
}
function showDialog(title,html){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=html;if(!$('#dialog').open)$('#dialog').showModal()}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,3500)}
function openEvent(id,detail='info'){
 const e=events.find(e=>e.id===id);if(!e)return;if(e.draft){createForm(e);return}
 if(detail==='chat')showDialog('Чат события',`<h3>${esc(e.title)}</h3><p class="muted">Здесь будет общение с участниками. Чат пока не подключён.</p><button class="primary" data-detail="info" data-id="${esc(e.id)}">К деталям события</button>`);
 else if(detail==='gift')showDialog('Список подарков',`<h3>${esc(e.title)}</h3><p class="muted">Организатор пока не добавил пожелания.</p><button class="primary" data-action="open-wishlist">Перейти к вишлистам</button>`);
 else if(detail==='people')showDialog('Участники',`<h3>${esc(e.title)}</h3><p class="muted">${e.people} участников в демо-событии</p>${['Анна · организатор','Максим','Дмитрий','Елена'].slice(0,Math.min(e.people,4)).map(n=>`<div class="notice">${esc(n)}</div>`).join('')}${e.people>4?`<p class="muted">И ещё ${e.people-4} участников</p>`:''}`);
 else showDialog(e.title,`<div class="detail-cover" aria-hidden="true">${{birthday:'🎂',sochi:'🌴',halloween:'🎃',ski:'⛷',newyear:'🎄'}[e.art]||'♡'}</div><p class="meta">${icon('calendar')}${esc(dateText(e))}</p><p class="meta">${icon('pin')}${esc(e.place)}</p>${e.address?`<p class="muted">${esc(e.address)}</p>`:''}<p class="muted">${e.people||1} участников · демонстрационное событие</p><div class="form-actions"><button class="secondary" data-detail="people" data-id="${esc(e.id)}">Участники</button><button class="secondary" data-detail="gift" data-id="${esc(e.id)}">Список подарков</button></div>`);
}
function createForm(e={}){showDialog('Создать событие',`<iframe id="create-event-frame" title="Создать событие" src="03-create-event.html?embed=1" style="width:100%;height:78vh;border:0;display:block"></iframe>`);const frame=document.getElementById('create-event-frame');frame.onload=()=>frame.contentWindow.postMessage({source:'family-events-host',action:'init',event:e},location.protocol==='file:'?'*':location.origin)}
window.addEventListener('message',event=>{if(event.source!==document.getElementById('create-event-frame')?.contentWindow||event.data?.source!=='family-events-create')return;if(event.data.action==='cancel'){$('#dialog').close();return;}if(event.data.action==='created'){const e=event.data.event;const previousEvents=events;events=events.concat(e);const stored=storage.set('fe-events-v1',JSON.stringify(events));if(!stored){events=previousEvents;document.getElementById('create-event-frame').contentWindow.postMessage({source:'family-events-host',action:'storage-error'},location.protocol==='file:'?'*':location.origin);return;}$('#dialog').close();navigate('events');render();showDialog('Управление событием',`<div role="status" class="panel"><strong>Событие создано</strong><p>Пригласите близких — гостям не нужна регистрация.</p></div><h3>${esc(e.title)}</h3><p>${esc(e.date)}${e.time?' · '+esc(e.time):''}${e.end?'–'+esc(e.end):''}</p><p class="muted">${esc(e.timezone)}</p>${e.place?`<p>${esc(e.place)}</p>`:''}${e.address?`<p>${esc(e.address)}</p>`:''}<button class="primary" id="invite-created">Пригласить гостей</button><p class="muted">Событие сохранено в этом браузере. Публичные приглашения появятся после подключения сервера.</p>`);document.getElementById('invite-created').onclick=()=>toast('В прототипе публичная ссылка пока недоступна');}});
function saveEvent(draft){const form=$('#event-form');if(!draft&&!form.reportValidity())return;const data=new FormData(form);const title=String(data.get('title')).trim();if(!title){form.elements.title.setCustomValidity('Укажите название события');form.elements.title.reportValidity();return}
 const id=form.dataset.id||'local-'+Date.now();const e={id,title,date:String(data.get('date')),time:String(data.get('time')),place:String(data.get('place')).trim()||'Место ещё не выбрано',art:'custom',people:1,draft};events=events.filter(item=>item.id!==id).concat(e);const stored=storage.set('fe-events-v1',JSON.stringify(events));$('#dialog').close();activeTab=category(e);query='';navigate('events');render();toast(stored?(draft?'Черновик сохранён':'Событие создано'):'Событие добавлено на время сеанса: сохранение недоступно')}
 document.addEventListener('input',event=>{if(event.target.closest('#wishlist-form')){wishlistDraft.title=$('#wishlist-title').value;wishlistDraft.description=$('#wishlist-description').value;$('#wishlist-count').textContent=wishlistDraft.title.length+' / 60';$('.wishlist-submit').disabled=!wishlistDraft.title.trim();}if(event.target.id==='search'){query=event.target.value;renderEvents()}if(event.target.name==='title')event.target.setCustomValidity('')});
 document.addEventListener('change',event=>{if(event.target.closest('#wishlist-form')&&event.target.name==='access')wishlistDraft.access=event.target.value});
 document.addEventListener('submit',event=>{if(event.target.id==='wishlist-form'){event.preventDefault();saveWishlist();return;}if(event.target.id==='wish-item-form'){event.preventDefault();saveWishItem(event.target);return;}if(event.target.id==='event-form'){event.preventDefault();saveEvent(false)}});
 document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
 if(b.dataset.wishlist){navigate('wishlist/'+b.dataset.wishlist);return;}if(b.dataset.route){navigate(b.dataset.route);return}if(b.dataset.tab){activeTab=b.dataset.tab;render();$('#tab-'+activeTab).focus();return}if(b.dataset.event){openEvent(b.dataset.event);return}if(b.dataset.detail){openEvent(b.dataset.id,b.dataset.detail);return}
 switch(b.dataset.action){case 'login':signedIn=true;storage.set('fe-demo-login','1');navigate('events');render();break;case 'logout':signedIn=false;storage.remove('fe-demo-login');$('#dialog').close();location.hash='events';render();break;case 'create':createForm();break;case 'close':if(document.getElementById('create-event-frame')){document.getElementById('create-event-frame').contentWindow.postMessage({source:'family-events-host',action:'cancel-request'},location.protocol==='file:'?'*':location.origin)}else $('#dialog').close();break;case 'save-draft':saveEvent(true);break;case 'search':searchOpen=true;navigate('events');render();$('#search').focus();break;case 'clear-search':query='';searchOpen=false;render();$('#search-toggle').focus();break;case 'wishlist':navigate('wishlist-new');window.scrollTo(0,0);break;case 'wishlist-cover':wishlistDraft.cover=wishlistCovers[(wishlistCovers.indexOf(wishlistDraft.cover)+1)%wishlistCovers.length];$('#wishlist-cover-art').innerHTML=wishlistCoverArt(wishlistDraft.cover);$('.wishlist-cover').dataset.cover=wishlistDraft.cover;$('.wishlist-cover').setAttribute('aria-label','Обложка: '+wishlistCoverLabels[wishlistDraft.cover]);break;case 'open-wishlist':$('#dialog').close();navigate('wishlist');break;case 'notifications':showDialog('Уведомления',`<p class="muted">Примеры уведомлений</p>${[['День рождения Анны','Не забудьте выбрать подарок.','anna'],['Поездка в Сочи','Проверьте детали встречи.','sochi'],['Хэллоуин у нас дома','Планируем вечер вместе.','halloween']].map(([title,text,id])=>`<div class="notice"><strong>${title}</strong><p>${text}</p><button class="secondary" data-event="${id}">Открыть событие</button></div>`).join('')}`);break}
 });
 document.addEventListener('keydown',event=>{if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const tabs=['upcoming','past','drafts'];let i=tabs.indexOf(activeTab);i=event.key==='Home'?0:event.key==='End'?2:(i+(event.key==='ArrowRight'?1:2))%3;activeTab=tabs[i];render();$('#tab-'+activeTab).focus()}});
 $('#dialog').addEventListener('cancel',event=>{const frame=document.getElementById('create-event-frame');if(frame){event.preventDefault();frame.contentWindow.postMessage({source:'family-events-host',action:'cancel-request'},location.protocol==='file:'?'*':location.origin);}});
 $('#dialog').addEventListener('click',event=>{if(event.target===$('#dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){const frame=document.getElementById('create-event-frame');if(frame)frame.contentWindow.postMessage({source:'family-events-host',action:'cancel-request'},location.protocol==='file:'?'*':location.origin);else event.target.close()}}});
 window.addEventListener('hashchange',render);render();
