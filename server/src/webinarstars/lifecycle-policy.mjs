export const WEBINARSTARS_SEGMENTS = Object.freeze({
  NO_SHOW: 'NO_SHOW',
  LEFT_BEFORE_OFFER: 'LEFT_BEFORE_OFFER',
  REACHED_OFFER_CTA_UNSEEN: 'REACHED_OFFER_CTA_UNSEEN',
  CTA_SEEN_NOT_CLICKED: 'CTA_SEEN_NOT_CLICKED',
  CTA_CLICKED_NO_APPLICATION: 'CTA_CLICKED_NO_APPLICATION',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  SUPPRESSED: 'SUPPRESSED',
});

export const WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS = Object.freeze({
  NO_SHOW: Object.freeze({ templateId: 'ws_no_show_v1', purpose: 'return_to_next_webinar', cta: 'next_webinar', variables: Object.freeze(['next_webinar_url']) }),
  LEFT_BEFORE_OFFER: Object.freeze({ templateId: 'ws_left_before_offer_v1', purpose: 'return_to_webinar', cta: 'next_webinar', variables: Object.freeze(['next_webinar_url']) }),
  REACHED_OFFER_CTA_UNSEEN: Object.freeze({ templateId: 'ws_offer_unseen_v1', purpose: 'move_to_application', cta: 'application', variables: Object.freeze(['application_url']) }),
  CTA_SEEN_NOT_CLICKED: Object.freeze({ templateId: 'ws_cta_seen_v1', purpose: 'remove_application_barrier', cta: 'application', variables: Object.freeze(['application_url']) }),
  CTA_CLICKED_NO_APPLICATION: Object.freeze({ templateId: 'ws_cta_clicked_v1', purpose: 'complete_application', cta: 'application', variables: Object.freeze(['application_url']) }),
});

export const WEBINARSTARS_FOLLOW_UP_POLICY = Object.freeze({
  NO_SHOW: Object.freeze({ ruleId: 'ws_no_show_30m_v1', delayMinutes: 30 }),
  LEFT_BEFORE_OFFER: Object.freeze({ ruleId: 'ws_left_before_offer_60m_v1', delayMinutes: 60 }),
  REACHED_OFFER_CTA_UNSEEN: Object.freeze({ ruleId: 'ws_reached_offer_unseen_60m_v1', delayMinutes: 60 }),
  CTA_SEEN_NOT_CLICKED: Object.freeze({ ruleId: 'ws_cta_seen_60m_v1', delayMinutes: 60 }),
  CTA_CLICKED_NO_APPLICATION: Object.freeze({ ruleId: 'ws_cta_clicked_20m_v1', delayMinutes: 20 }),
});

export function decideWebinarStarsSegment({ visitorSignals = null, applicationSubmitted = false, suppressionReason = null, offerBoundarySeconds = 3300 } = {}) {
  if (suppressionReason) return WEBINARSTARS_SEGMENTS.SUPPRESSED;
  if (applicationSubmitted) return WEBINARSTARS_SEGMENTS.APPLICATION_SUBMITTED;
  if (!visitorSignals) return WEBINARSTARS_SEGMENTS.NO_SHOW;
  if (visitorSignals.targetCtaClicked) return WEBINARSTARS_SEGMENTS.CTA_CLICKED_NO_APPLICATION;
  if (visitorSignals.targetCtaSeen) return WEBINARSTARS_SEGMENTS.CTA_SEEN_NOT_CLICKED;
  return Number(visitorSignals.presenceSeconds ?? 0) >= offerBoundarySeconds
    ? WEBINARSTARS_SEGMENTS.REACHED_OFFER_CTA_UNSEEN
    : WEBINARSTARS_SEGMENTS.LEFT_BEFORE_OFFER;
}
