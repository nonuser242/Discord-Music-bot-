require('dotenv').config();

const { 
  Client, 
  GatewayIntentBits, 
  ActivityType, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  EmbedBuilder 
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');

// 1. Initializing Client-ka
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// 2. Slash Commands Configuration
const commands = [
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Bot-ku wuxuu galayaa call-ka aad ku jirto si uu ugu sii jiro'),

  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Bot-ku wuxuu ka baxayaa call-ka'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Ka hel link-ka bot-ka looga soo daro server-ka'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hel caawinaad iyo liiska amarrada bot-ka')
].map(command => command.toJSON());

// 3. Ready Event & Status Loop
client.on('ready', async () => {
  console.log(`✅ Bot-kii waa online: ${client.user.tag}`);

  // Diwaan-gelinta Slash Commands
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✅ Slash Commands-kii waa la diwaan-geliyay!');
  } catch (error) {
    console.error('❌ Cillad diwaan-gelinta amarrada:', error);
  }

  // Active Listening Status (Timer & Lyrics)
  const startTime = Date.now();
  const songDurationSeconds = 210; // 3 daqiiqo iyo 30 ilbiriqsi

  client.user.setActivity('Cris MJ - Part Time', {
    type: ActivityType.Listening,
    state: '🎵 Lyrics: Y si algún día te vuelvo a ver...',
    timestamps: {
      start: startTime,
      end: startTime + (songDurationSeconds * 1000)
    }
  });
});

// 4. Slash Commands Handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild } = interaction;

  // /connect Command
  if (commandName === 'connect') {
    const voiceChannel = member.voice.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Fadlan horta gal Voice Call si aan kuugu soo joogo!', ephemeral: true });
    }

    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false
    });

    await interaction.reply(`🔊 Waxaan galay call-ka: **${voiceChannel.name}**. Khadka waan ku jirayaa ilaa aad ka tiraahdo \`/disconnect\`!`);
  }

  // /disconnect Command
  else if (commandName === 'disconnect') {
    const connection = getVoiceConnection(guild.id);

    if (!connection) {
      return interaction.reply({ content: '❌ Hadda kuraasi/call ma ugu jiro server-kan!', ephemeral: true });
    }

    connection.destroy();
    await interaction.reply('👋 Ka bixidda call-ka waa lagu guuleystay.');
  }

  // /invite Command
  else if (commandName === 'invite') {
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;
    await interaction.reply(`🔗 **Si aad bot-ka uga soo darto server-kaaga guji link-kan:**\n${inviteUrl}`);
  }

  // /help Command
  else if (commandName === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📌 Caawinaada Bot-ka (Help Menu)')
      .setDescription('Waa kan liiska amarrada aad isticmaali karto:')
      .addFields(
        { name: '`/connect`', value: 'Bot-ku wuxuu galayaa call-ka aad ku jirto, uguma baxayo ilaa disconnect la dhaho.' },
        { name: '`/disconnect`', value: 'Bot-ku wuxuu ka baxayaa call-ka uu ku jiro.' },
        { name: '`/invite`', value: 'Ka hel link-ka bot-ka looga soo daro server-kaaga.' },
        { name: '`/help`', value: 'Muujinta fariintan caawinaada ah.' }
      )
      .setFooter({ text: 'Active Listening Bot' });

    await interaction.reply({ embeds: [helpEmbed] });
  }
});

// Direct access to Token through Environment Variable
client.login(process.env.BOT_TOKEN);
