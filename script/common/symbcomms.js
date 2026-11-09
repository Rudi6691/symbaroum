
export class SymbaroumCommsListener
{
    static async receiveData(comData) 
    {
        if(game.user.isGM && comData.type === "GMMessage")
        {
            const html = await foundry.applications.handlebars.renderTemplate("systems/symbaroum/template/chat/applyEffectsButton.hbs");
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
    }

    static async ready() {
        game.socket.on("system.symbaroum",SymbaroumCommsListener.receiveData);

        game.symbaroum.emit = (data) => {       
            game.socket.emit("system.symbaroum", data );
            SymbaroumCommsListener.receiveData(data);
        };
    }
}