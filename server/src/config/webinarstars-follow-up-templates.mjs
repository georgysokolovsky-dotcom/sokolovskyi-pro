// Explicitly approved for staging simulation only. Production does not import this configuration.
export const WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES = Object.freeze({
  NO_SHOW: Object.freeze({
    templateId: 'ws_no_show_v1', purpose: 'return_to_next_webinar', approved: true,
    text: 'Ты был записан на вебинар, но в этот раз не попал внутрь.\n\nЯ оставлю тебе следующий запуск. На вебинаре я разбираю, почему в отношениях мужчина постепенно теряет влияние, что обычно усиливает дистанцию с женщиной и с чего начинать восстановление своей позиции.\n\nЛучше пройти его целиком, потому что ближе к концу я показываю, как перейти от общей информации к разбору своей ситуации.',
    cta: 'next_webinar', ctaLabel: 'Записаться на следующий вебинар', variables: Object.freeze(['next_webinar_url']),
  }),
  LEFT_BEFORE_OFFER: Object.freeze({
    templateId: 'ws_left_before_offer_v1', purpose: 'return_to_webinar', approved: true,
    text: 'Ты заходил на вебинар, но вышел до той части, где я собираю всё в конкретный план действий.\n\nВ начале я объясняю причины происходящего. Дальше разбираю, что мужчина меняет в своём поведении, чтобы перестать усиливать холод, конфликты и зависимость от реакции женщины.\n\nОставляю следующий запуск. Лучше пройти его с начала до конца, без попытки собрать решение из отдельных фрагментов.',
    cta: 'next_webinar', ctaLabel: 'Посмотреть следующий вебинар', variables: Object.freeze(['next_webinar_url']),
  }),
  REACHED_OFFER_CTA_UNSEEN: Object.freeze({
    templateId: 'ws_offer_unseen_v1', purpose: 'move_to_application', approved: true,
    text: 'Ты провёл на вебинаре достаточно времени, но до записи на разбор не дошёл.\n\nПоэтому оставлю следующий шаг отдельно. На разборе я беру уже не общую тему отношений, а твою конкретную ситуацию, что происходит между вами сейчас, где ты теряешь позицию и какие действия имеет смысл прекратить или изменить.\n\nПосле этого у тебя остаётся понятная последовательность следующих шагов.',
    cta: 'application', ctaLabel: 'Записаться на разбор', variables: Object.freeze(['application_url']),
  }),
  CTA_SEEN_NOT_CLICKED: Object.freeze({
    templateId: 'ws_cta_seen_v1', purpose: 'remove_application_barrier', approved: true,
    text: 'Ты дошёл до части вебинара, где я предложил разбор, но к записи не переходил.\n\nНа разборе мы не пересказываем вебинар. Я смотрю твою ситуацию отдельно, отношения, последние события, твои действия и реакцию женщины. Затем показываю, где сейчас находится основная точка, которая продолжает ухудшать ситуацию.\n\nЕсли хочешь разбирать уже свой случай, запись оставляю здесь.',
    cta: 'application', ctaLabel: 'Перейти к разбору', variables: Object.freeze(['application_url']),
  }),
  CTA_CLICKED_NO_APPLICATION: Object.freeze({
    templateId: 'ws_cta_clicked_v1', purpose: 'complete_application', approved: true,
    text: 'Ты уже переходил к записи на разбор, но заявку не завершил.\n\nЕсли ситуация всё ещё актуальна, закончи форму. Там нужны только данные, которые помогают мне понять контекст до встречи.\n\nПосле отправки заявки следующий шаг будет уже по твой конкретной ситуации.',
    cta: 'application', ctaLabel: 'Завершить заявку', variables: Object.freeze(['application_url']),
  }),
});
