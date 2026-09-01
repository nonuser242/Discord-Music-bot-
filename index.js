const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  EmbedBuilder 
} = require('discord.js');
const { 
  joinVoiceChannel, 
  getVoiceConnection, 
  createAudioPlayer, 
  createAudioResource, 
  NoSubscriberBehavior 
} = require('@discordjs/voice');
const play = require('@iamtraction/play-dl');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const players = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Ku daar hees Voice Call-ka.')
    .addStringOption(option =>
      option.setName('song')
        .setDescription('Magaca heesta ama Link')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Bot-ka ku xir Voice Call-ka.'),
  
  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Bot-ka ka saar Voice Call-ka.'),
  
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hel caawimaad ku saabsan amarrada bot-ka.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Soo saar linkiga loogu yeero bot-ka.'),

  new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Raadi lyrics-ka hees aad rabto.')
    .addStringOption(option => 
      option.setName('song')
        .setDescription('Magaca heesta ama fanaanka')
        .setRequired(true))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    if (!TOKEN || !CLIENT_ID) {
      console.error('❌ Deji TOKEN iyo CLIENT_ID Environment Variables!');
      return;
    }
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('✅ Amarrada waa lagu guuleystay!');
  } catch (error) {
    console.error('❌ Dhib ayaa ka dhacday amarrada:', error);
  }
})();

client.once('ready', () => {
  console.log(`✅ Bot Online: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // --- COMMAND: /play ---
  if (commandName === 'play') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Horta gal Voice Call!', flags: 64 });
    }

    await interaction.deferReply();
    const songQuery = interaction.options.getString('song');

    try {
      let stream;
      let title = songQuery;
      let songUrl = '';

      // Tallaabada 1-aad: Ka raadi SoundCloud mar walba si looga fogaado YouTube IP Block
      const scResults = await play.search(songQuery, { limit: 1, source: { soundcloud: 'tracks' } });
      
      if (scResults && scResults.length > 0) {
        const track = scResults[0];
        stream = await play.stream_from_info(track);
        title = track.title;
        songUrl = track.permalink || track.url;
      } else {
        // Tallaabada 2-aad: Haddii SoundCloud wax lagu waayo, YouTube ka raadi
        const ytResults = await play.search(songQuery, { limit: 1 });
        if (!ytResults || ytResults.length === 0) {
          return interaction.editReply('❌ Wax hees ah looma helin magacaas!');
        }
        const video = ytResults[0];
        stream = await play.stream(video.url);
        title = video.title;
        songUrl = video.url;
      }

      let connection = getVoiceConnection(interaction.guild.id);
      if (!connection) {
        connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });
      }

      let player = players.get(interaction.guild.id);
      if (!player) {
        player = createAudioPlayer({
          behaviors: { noSubscriber: NoSubscriberBehavior.Play }
        });
        players.set(interaction.guild.id, player);
        connection.subscribe(player);
      }

      const resource = createAudioResource(stream.stream, { inputType: stream.type });
      player.play(resource);

      const embed = new EmbedBuilder()
        .setTitle('🎶 Now Playing')
        .setDescription(`**[${title}](${songUrl})**`)
        .setColor('#00ff7f');

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return interaction.editReply('❌ Dhib ayaa ka dhacday shididda heesta! Hubi in heestu jira.');
    }
  }

  // --- COMMAND: /connect ---
  if (commandName === 'connect') {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({ content: '❌ Horta gal Voice Call!', flags: 64 });
    }

    joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });

    return interaction.reply(`✅ Bot-ku wuxuu ku xirmay: **${voiceChannel.name}**`);
  }

  // --- COMMAND: /disconnect ---
  if (commandName === 'disconnect') {
    const connection = getVoiceConnection(interaction.guild.id);
    if (!connection) {
      return interaction.reply({ content: '❌ Bot-ku kuma jiro Voice Call!', flags: 64 });
    }

    connection.destroy();
    players.delete(interaction.guild.id);
    return interaction.reply('🔌 Bot-kii waa ka baxay Voice Call-ka.');
  }

  // --- COMMAND: /help ---
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Help Menu')
      .setColor('#0099ff')
      .setDescription('Amarrada bot-ka:')
      .addFields(
        { name: '/play <song>', value: 'Ku daar hees Voice Call-ka.' },
        { name: '/connect', value: 'Bot-ka ku xir Voice Call.' },
        { name: '/disconnect', value: 'Bot-ka ka saar Voice Call.' },
        { name: '/lyrics <song>', value: 'Soo saar lyrics-ka heesta.' },
        { name: '/invite', value: 'Soo saar linkiga bot-ka.' }
      );

    return interaction.reply({ embeds: [embed] });
  }

  // --- COMMAND: /invite ---
  if (commandName === 'invite') {
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
    return interaction.reply({ content: `🔗 Linkiga bot-ka: ${inviteUrl}` });
  }

  // --- COMMAND: /lyrics ---
  if (commandName === 'lyrics') {
    await interaction.deferReply();
    const songTitle = interaction.options.getString('song');

    try {
      const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(songTitle)}`);
      const results = await response.json();

      if (!results || results.length === 0 || !results[0].plainLyrics) {
        return interaction.editReply(`❌ Wax lyrics ah looma helin heesta: **${songTitle}**`);
      }

      const track = results[0];
      const formattedLyrics = track.plainLyrics
        .split('\n')
        .map(line => `-# ${line}`)
        .join('\n');

      const finalLyrics = formattedLyrics.length > 4000 
        ? formattedLyrics.substring(0, 3900) + '\n-# ... (lyrics-ku waa uu ka dheeraa xadka)'
        : formattedLyrics;

      const embed = new EmbedBuilder()
        .setTitle(`🎶 Lyrics: ${track.trackName || songTitle}`)
        .setAuthor({ name: track.artistName || 'Unknown Artist' })
        .setColor('#1DB954')
        .setDescription(finalLyrics);

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return interaction.editReply('❌ Dhib ayaa ka dhacday raadinta lyrics-ka!');
    }
  }
});

client.login(TOKEN);
