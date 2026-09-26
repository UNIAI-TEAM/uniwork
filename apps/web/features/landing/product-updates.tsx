"use client";
import { Check, Inbox, Paperclip, Star } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";

/** Local email preview; selection and stars never touch a real mailbox. */
export function EmailDemo() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(0);
  const [starred, setStarred] = useState<number[]>([]);
  const isStarred = starred.includes(selected);
  const senders = ["Minh Linh", "Hoàng Anh", "Lan Trần"];
  return <figure className="story-demo email-demo" aria-label={t("landing.updates.emailTab")}>
    <div className="mail-workspace">
      <div className="mail-list">
        <div className="mail-folder"><Inbox aria-hidden /><strong>{t("landing.updates.inbox")}</strong><span>3</span></div>
        {senders.map((name, index) => <button key={name} type="button" className="mail-thread" aria-pressed={selected === index} onClick={() => setSelected(index)}>
          <span><strong>{name}</strong><small>{["09:41", "09:20", "08:56"][index]}</small></span>
          <span>{t(`landing.updates.mailSubject${index}`)}</span>
          <small>{t(`landing.updates.mailSnippet${index}`)}</small>
        </button>)}
        <div className="mail-protocol"><Check aria-hidden />IMAP / SMTP</div>
      </div>
      <div className="mail-reader">
        <div className="mail-reader-tools"><span>{t("landing.updates.inbox")}</span><Button variant="ghost" size="icon" aria-label={t(isStarred ? "landing.updates.unstar" : "landing.updates.star")} aria-pressed={isStarred} onClick={() => setStarred(isStarred ? starred.filter((item) => item !== selected) : [...starred, selected])}><Star aria-hidden fill={isStarred ? "currentColor" : "none"} /></Button></div>
        <h3>{t(`landing.updates.mailSubject${selected}`)}</h3>
        <div className="mail-sender"><span className="preview-avatar">{["ML", "HA", "LT"][selected]}</span><strong>{senders[selected]}</strong></div>
        <p>{t(`landing.updates.mailBody${selected}`)}</p>
        <span className="mail-attachment"><Paperclip aria-hidden />{t(`landing.updates.mailAttachment${selected}`)}</span>
        <p className="story-demo-note">{t("landing.updates.mailHint")}</p>
      </div>
    </div>
  </figure>;
}
