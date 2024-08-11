require('dotenv').config();

const {Client, IntentsBitField} = require('discord.js');
const OpenAi = require('openai');

const openai = new OpenAi({
    apiKey: process.env.TOKEN_OPENAI,
})

const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.MessageContent,
    ]
})

client.on('ready', () => {
    console.log('Le bot est prêt !');
})

client.on('messageCreate', async(message) => {
    console.log('Voici le message : ', message.content);

    if (message.content.startsWith('!')){
        
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
    
})

client.login(process.env.TOKEN_BOT)