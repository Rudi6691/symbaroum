
export class SymbaroumCommsListener
{
    static async receiveData(comData) 
    {
        /* v2.7 F40 (Rudolfs Freigabe 21.11.: "Symbole beim Zonen-Ende
           sofort automatisch ohne GM-Karte, alle Zonentypen"): Zonen-
           Ende-Raeumungen (roll.js createModifyTokenAutoApply, nur
           removeEffect-Eintraege) fuehrt der GM-Client DIREKT aus -
           Muster der a29-doomed-Schleife und des GM-Karten-Handlers
           (hooks.js renderChatMessageHTML): Token ueber tokenId
           aufloesen, Akteur-Fallbacks wie dort, removeCondition je
           Eintrag, try/catch je Marker (ein Misserfolg stoppt die
           restlichen nicht) und EINE Trace-Zeile (F28-Muster) fuer
           die Kontrolle im Log. */
        if (game.user.isGM && comData.type === "GMMessageAuto")
        {
            const autoRemoved = [];
            for (const flagData of comData.data ?? [])
            {
                if (!flagData?.tokenId && !flagData?.actorId) continue;
                const token = flagData.tokenId ? canvas.tokens?.objects?.children?.find((t) => t.id === flagData.tokenId) : null;
                const actor = token?.actor ?? (flagData.actorId ? game.actors?.get(flagData.actorId) : null) ?? (flagData.actorId ? canvas.tokens?.objects?.children?.find((t) => t.actor?.id === flagData.actorId)?.actor : null);
                if (!actor || !flagData.removeEffect) continue;
                try
                {
                    await actor.removeCondition(flagData.removeEffect);
                    autoRemoved.push({ tokenId: flagData.tokenId ?? null, statusId: flagData.removeEffect });
                }
                catch (autoApplyError)
                {
                    console.warn("Symbaroum Hymnen: Zonen-Ende-Marker konnte nicht entfernt werden", flagData, autoApplyError);
                }
            }
            console.info("Symbaroum Hymnen [trace] Zonen-Ende: Marker automatisch entfernt", { removedCount: autoRemoved.length, removed: autoRemoved });
            return autoRemoved.length;
        }
        else if(game.user.isGM && comData.type === "GMMessage")
        {
            /* v2.7 (Testrunde 7, Rudolfs v2.7-Spec „EINE GM-Karte pro
               Vorgang"): sichtbare Eintrags-Liste über der Anwenden-Taste -
               jeder Eintrag nennt Ziel + Wirkung, damit der SL sieht, was
               die Karte anwendet (vorher stand nur der pauschale Text).
               Beschreibung je Eintrag: label-Feld bevorzugt (z. B. der
               Schadensfall-Text des Bannsiegels), sonst Zusatz-Symbol,
               Entfernen, Temporäre Korruption oder Schaden/Heilung. */
            const entries = (comData.data ?? []).map((flagData) => {
                const tokenName = flagData.tokenId
                    ? canvas.tokens?.objects?.children?.find((t) => t.id === flagData.tokenId)?.name
                    : null;
                const name =
                    tokenName ??
                    (flagData.actorId ? game.actors?.get(flagData.actorId)?.name : null) ??
                    "";
                let description = flagData.label ?? "";
                if (!description) {
                    if (flagData.addEffect) {
                        description = game.i18n.localize(flagData.addEffect.label ?? "");
                    } else if (flagData.removeEffect) {
                        description =
                            game.i18n.localize(flagData.removeEffect.label ?? "") +
                            " (" + game.i18n.localize("AOE.GMCARD_REMOVE") + ")";
                    } else if (flagData.corruptionChange != null) {
                        const value = Math.round(Number(flagData.corruptionChange) || 0);
                        description = game.i18n.format("AOE.GMCARD_CORRUPTION", {
                            count: (value > 0 ? "+" : "") + value,
                        });
                    } else if (flagData.toughnessChange != null) {
                        const value = Math.round(Number(flagData.toughnessChange) || 0);
                        description = game.i18n.format(
                            value < 0 ? "AOE.GMCARD_DAMAGE" : "AOE.GMCARD_HEALING",
                            { count: Math.abs(value) }
                        );
                    }
                }
                return { name: name, description: description };
            });
            const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/applyEffectsButton.hbs", { entries });
            const flagKey = `flags.${game.system.id}.applyEffects`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias:game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: html
            };
            chatData[flagKey] = comData.data;
            return ChatMessage.create(chatData);
        }
        else if(comData.type === "ResistRoll" && comData.data.targetUserId === game.userId)
        {
            let templateData = {
                introText: comData.data.introText,
                mainText: comData.data.mainText
            }
            const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/resistButton.hbs", templateData);
            const flagKey = `flags.${game.system.id}.resistRoll`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias:game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: html
            };
            chatData[flagKey] = comData.data;
            return ChatMessage.create(chatData);
        }
        /* Hymnen-Paket 1.6 (Rudolfs Testrunde v1.5, "Resist-Karte für
           Spieler"): Die Konzentrations-Karte des Spieler-Besitzers
           (emit aus hooks.js postConcentrationCard). Der Spieler
           würfelt JE ANDAUERNDER KRAFT die W20-Probe selbst (W20 ≤
           max(1, Willenskraft − Schaden), Auswertung im render-
           ChatMessageHTML-Handler zum Flag concentrationRequest in
           hooks.js), ein Misserfolg sendet concentrationFail an den
           GM-Socket; "Alle beenden" bleibt der GM-Karte vorbehalten
           (Rudolfs Freigabe 17.11.2026). */
        else if(comData.type === "ConcentrationCard" && comData.data.targetUserId === game.userId)
        {
            const d = comData.data;
            const buttons = (d.refs ?? []).map((r) =>
                `<button class="conc-probe" data-ref="${r.ref}"><i class="fas fa-dice-d20"></i> ${game.i18n.format("CONCENTRATION.BUTTON_PROBE", { powername: r.label ?? r.ref })}</button>`
            ).join(" ");
            /* Hymnen 1.7 (P9b, Rudolfs Testrunde v1.6.1): Optik auf das
               Upstream-Muster (resistButton.hbs) umgestellt - h4-Zeilen
               und die Buttons in einem <p> statt der finalTxt-Boxen,
               damit die Karte wie die uebrigen System-Karten aussieht.
               Verhalten unveraendert: Buttons behalten class="conc-probe"
               + data-ref, der Klick-Handler in hooks.js greift genauso
               zu (Klassen, nicht IDs). */
            const content = `<div class="symbaroum chat ability"><div class="foreground"><h4>${game.i18n.localize("CONCENTRATION.CARD_TITLE")}</h4><h4>${game.i18n.format("CONCENTRATION.CARD_LINE", { actorname: d.actorName, count: d.damage })}</h4><h4>${game.i18n.format("CONCENTRATION.CARD_TARGET", { resolute: d.resolute, damage: d.damage, target: d.target })}</h4><p>${buttons}</p></div></div>`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias: game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: content
            };
            chatData[`flags.${game.system.id}.concentrationRequest`] = d;
            return ChatMessage.create(chatData);
        }
        /* MM-Paket 1 v1.1 (Rudolfs Wunsch 1, SC-Widerstandsproben): Anfrage-
           karte des Opfer-Besitzers (emit aus item.js mm1SendResistProbe).
           Der Spieler würfelt die Widerstandsprobe je MERKMAL selbst (ein
           Button je ausstehendem Merkmal; Auswertung im render-
           ChatMessageHTML-Handler zum Flag mm1ResistRequest in hooks.js).
           NSC-Opfer nehmen diesen Fluss nicht (kein Besitzer: v1.0-
           Vollautomatik in item.js); die GM-Info-Whisper-Karte erzeugt
           mm1SendResistProbe selbst. Optik nach dem Hymnen-1.7-Muster
           der Konzentrations-Karte (h4-Zeilen, Buttons im <p>). */
        else if(comData.type === "MM1ResistProbe" && comData.data.targetUserId === game.userId)
        {
            const d = comData.data;
            const buttons = (d.probes ?? []).map((p) =>
                `<button class="mm1-resist-probe" data-kind="${p.kind}"><i class="fas fa-dice-d20"></i> ${game.i18n.format("TRAIT_MM1.PROBE_BUTTON", { traitname: p.label, target: p.target })}</button>`
            ).join(" ");
            const content = `<div class="symbaroum chat ability"><div class="foreground"><h4>${game.i18n.localize("TRAIT_MM1.PROBE_CARD_TITLE")}</h4><h4>${game.i18n.format("TRAIT_MM1.PROBE_CARD_LINE", { victimname: d.victimName, attackername: d.attackerName })}</h4><p>${buttons}</p></div></div>`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias: game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: content
            };
            chatData[`flags.${game.system.id}.mm1ResistRequest`] = d;
            return ChatMessage.create(chatData);
        }
        /* v1.5 (Rudolfs Punkt 2, Hungerprobe): Je-Besitzer-Anfragekarte —
           completeTravelDays sendet nach der Tageskarte pro Hunger-Mitglied
           eine geflüsterte Anfrage an den ersten aktiven Spieler-Besitzer
           (travel.js getOwnerPlayer). Muster wie ResistRoll: Karte gehört
           dem Besitzer, nach Klick auf die Würfel-Taste wird sie gelöscht
           (travel.js renderChatMessageHTML, Flag travelHungerRequest).
           GM-Fallback bleibt die Hunger-Taste auf der Tageskarte. */
        else if(comData.type === "TravelHungerProbe" && comData.data.targetUserId === game.userId)
        {
            let templateData = {
                introText: game.i18n.localize("TRAVEL.HUNGER_REQUEST_TITLE"),
                mainText: game.i18n.format("TRAVEL.HUNGER_REQUEST_MAIN", {name: comData.data.actorName})
            }
            const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/travel-probe-request.hbs", templateData);
            const flagKey = `flags.${game.system.id}.travelHungerRequest`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias:game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: html
            };
            chatData[flagKey] = comData.data;
            return ChatMessage.create(chatData);
        }
        /* S4.2 (Rudolfs Auswahlrunde 09.11., Albtraeume): Anfragekarte
           „Albtraeume pruefen“ — completeTravelDays sendet sie statt der
           Auto-Buchung, wenn ein heilungsbeduerftiges Reisemitglied die
           Last Albtraeume traegt. Der Spieler wuerfelt selbst (Willens-
           kraft): Erfolg = Heilung, Misserfolg = keine (travel.js
           recordNightmaresSuccess/recordNightmaresFailureCard). Muster
           TravelHungerProbe; Karte/Flagge travelNightmaresRequest. */
        else if(comData.type === "TravelNightmaresProbe" && comData.data.targetUserId === game.userId)
        {
            let templateData = {
                introText: game.i18n.localize("TRAVEL.NIGHTMARES_REQUEST_TITLE"),
                mainText: game.i18n.format("TRAVEL.NIGHTMARES_REQUEST_MAIN", {name: comData.data.actorName}),
                buttonText: game.i18n.localize("TRAVEL.NIGHTMARES_REQUEST_BUTTON")
            }
            const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/travel-probe-request.hbs", templateData);
            const flagKey = `flags.${game.system.id}.travelNightmaresRequest`;
            const chatData = {
                speaker: ChatMessage.getSpeaker({alias:game.i18n.localize("DIALOG.SYSTEM_MESSAGE")}),
                whisper: [game.user],
                content: html
            };
            chatData[flagKey] = comData.data;
            return ChatMessage.create(chatData);
        }
    }

    static async ready() {
        game.socket.on("system.symbaroum",SymbaroumCommsListener.receiveData);

        game.symbaroum.emit = (data) => {       
            game.socket.emit("system.symbaroum", data );
            SymbaroumCommsListener.receiveData(data);
        };
    }
}