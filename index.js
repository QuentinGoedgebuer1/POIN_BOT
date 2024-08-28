require('dotenv').config();
const {Client, IntentsBitField, VoiceChannel} = require('discord.js');
const util = require('util');
const { Readable } = require('stream');
const { OpusEncoder } = require('@discordjs/opus');
const { joinVoiceChannel, EndBehaviorType } = require('@discordjs/voice');
const witClient = require('node-witai-speech');
const OpenAi = require('openai');


const openai = new OpenAi({
    apiKey: process.env.TOKEN_OPENAI,
})

const client = new Client({
    intents: [
        IntentsBitField.Flags.GuildPresences,
        IntentsBitField.Flags.GuildVoiceStates,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessageTyping,
    ]
})

const guildMap = new Map();

client.on('ready', () => {
    console.log('Le bot est prêt !');
})

client.on('messageCreate', async(message) => {

    if (message.content.startsWith('!')){
        if(message.content == "!join"){
            const mapKey = message.guild.id
            await connect(message, mapKey)
        }
        else if(message.content == "!chatGPT"){
            try{
                const completion = await openai.chat.completions.create({
                    model: 'gpt-3.5-turbo',
                    messages: [{role: "system", content: message.content}]
                })
                if (completion.choices.length > 0 && completion.choices[0].message){
                    await message.reply(completion.choices[0].message)
                }
            } 
            catch(error){
                console.log(error);
            }
        }
    }
})

async function requestChatGPT(message, user, mapKey){
    console.log('i : ', message)
    const completion = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{role: "system", content: message}]
    })
    if (completion.choices.length > 0 && completion.choices[0].message){
        let val = guildMap.get(mapKey);
        console.log('completion : ' + JSON.stringify(completion.choices[0].message.content))
        val.text_Channel.send(user.username + ' : ' + JSON.stringify(completion.choices[0].message.content).substr(1).slice(0, -1))
    }
}


async function connect(msg, mapKey){
    try{
        let voice_Channel = await client.channels.fetch(msg.member.voice.channel.id);
        if (!voice_Channel) return msg.reply("Erreur : Le channel vocal n'existe pas");
        let text_channel = await client.channels.fetch(msg.channel.id);
        if(!text_channel) return msg.reply("Erreur : Le channel textuel n'existe pas");
        const voice_Connection = joinVoiceChannel({
            channelId: voice_Channel.id,
            guildId : voice_Channel.guild.id,
            adapterCreator : voice_Channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true
        });

        guildMap.set(mapKey, {
            'text_Channel': text_channel,
            'voice_Channel': voice_Channel,
            'voice_Connection': voice_Connection,
            'selected_lang': 'fr',
            'debug': false
        });
        speak_impl(voice_Connection, mapKey)
        voice_Connection.on('disconnect', async(e) => {
            if (e) console.log(e)
            guildMap.delete(mapKey);
        });
        msg.reply('Connecté !');

    } 
    catch(e){
        console.log('connect : ', e);
        msg.reply('Erreur : Impossible de rejoindre le channel vocal.');
        throw e;
    }
}

function speak_impl(voice_Connection, mapKey){
    console.log('test')
    const receiver = voice_Connection.receiver;
    receiver.speaking.on('start', async (userId) => {
        console.log('oui')
        const user = client.users.cache.get(userId);
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000
            }
        });

        const encoder = new OpusEncoder(48000, 2);
        let buffer = [];
        audioStream.on('data', chunk => { buffer.push(encoder.decode(chunk))});
        audioStream.once('end', async () => {
            buffer = Buffer.concat(buffer);
            const duration = buffer.length / 48000 / 4;
            console.log("duration : ", duration);

            if(duration < 1.0 || duration > 19){
                console.log('TROP COURT / TROP LONG');
                return;
            }

            try{
                let new_buffer = await convert_audio(buffer);
                let out = await transcribe_witai(new_buffer);
                if(out != null && out.toLowerCase().includes("question")){
                    if(out && out.length){
                        await requestChatGPT(out, user, mapKey);
                    }
                }
            }
            catch(e){
                console.log('Erreur : ', e);
            }
        })
    })
}

async function convert_audio(input) {
    try {
        // stereo to mono channel
        const data = new Int16Array(input)
        const ndata = data.filter((el, idx) => idx % 2);
        return Buffer.from(ndata);
    } catch (e) {
        console.log(e)
        console.log('convert_audio: ' + e)
        throw e;
    }
}

// WitAI
let witAI_lastcallTS = null;
async function transcribe_witai(buffer) {
    try {
        // ensure we do not send more than one request per second
        if (witAI_lastcallTS != null) {
            let now = Math.floor(new Date());    
            while (now - witAI_lastcallTS < 1000) {
                console.log('sleep')
                await sleep(100);
                now = Math.floor(new Date());
            }
        }
    } catch (e) {
        console.log('transcribe_witai 837:' + e)
    }

    try {
        console.log('transcribe_witai')
        const extractSpeechIntent = util.promisify(witClient.extractSpeechIntent);
        var stream = Readable.from(buffer);
        const contenttype = "audio/raw;encoding=signed-integer;bits=16;rate=48k;endian=little"
        const output = await extractSpeechIntent(process.env.TOKEN_WITAI, stream, contenttype)
        witAI_lastcallTS = Math.floor(new Date());
        stream.destroy()
        console.log('test')

        // var newOutput = output.slice(0, -1);
        var newOutput = '[' + output + ']';

        function correctJsonErrors(jsonString) {
          // Remove any double commas
          jsonString = jsonString.replace(/,(\s*,)+/g, ',');
      
          // Correct missing commas between objects
          jsonString = jsonString.replace(/}\s*{/g, '}, {');
      
          return jsonString;
        }
      
        // Correct the JSON string
        let correctedJsonString = correctJsonErrors(newOutput);
        
        // Optional: parse and stringify to format and validate the JSON
        try {
            let jsonObj = JSON.parse(correctedJsonString);
            let formattedJson = JSON.stringify(jsonObj, null, 2);
            console.log('Corrected and formatted JSON:\n', formattedJson);
        } catch (error) {
            console.error('Error parsing JSON:', error);
        }

        var text = JSON.parse(correctedJsonString)
        var newText = text.filter(item => item.type == "FINAL_UNDERSTANDING")

        console.log('newText : ', newText[0].text)

        return newText[0].text
    } catch (e) { console.log('transcribe_witai 851:' + e); console.log(e) }
}

client.login(process.env.TOKEN_BOT)