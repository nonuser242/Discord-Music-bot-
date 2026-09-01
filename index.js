const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder 
} = require('discord.js');
const { joinVoiceChannel, getVoiceConnection } = require('@discordjs/voice');
const axios = require('axios');

// Abuur client-ka bot-ka
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// TOKEN IYO CLIENT_ID KAAGA
const TOKEN = process.env.TOKEN || 'TOKEN-KAAGA-HAKAN-KU-JIRO';
const CLIENT_ID = process.env.CLIENT_ID || '1543273003822092469';

// ---------------------------------------------------------
// 1. SKEMA-KA AMARRADA (SLASH COMMANDS SETUP)
// ---------------------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Bot-ka wuxuu ku soo qooyayaa salka ama Voice Channel-ka aad ku jirto.'),
  
  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Bot-ka ka saar Voice Channel-ka uu ku jiro.'),
  
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Ka eeg dhammaan amarrada uu bot-ku leeyahay iyo sida loo isticmaalo.'),

  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Hel linkiga lagu soo casuumo bot-ka server-kaaga.'),

  new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Raadi lyrics-ka (ereyada) hees aad rabto.')
    .addStringOption(option => 
      option.setName('song')
        .setDescription('Magaca heesta ama fanaanka')
        .setRequired(true))
].map(command => command.toJSON());

// ---------------------------------------------------------
// 2. DIWAANGELINTA AMARRADA (REGISTER SLASH COMMANDS)
// ---------------------------------------------------------
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Bilaabida diwaangelinta amarrada (Slash Commands)...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('Amarrada waa lagu guuleystay inaad ku diwaangeliso!');
  } catch (error) {
    console.error('Dhib ayaa ka dhacday diwaangelinta amarrada:', error);
  }
})();

// ---------------------------------------------------------
// 3. SHUQULKA AMARRADA (COMMAND HANDLERS)
// ---------------------------------------------------------
client.on('ready', () => {
  console.log(`Bot-ka waa shaqaynayaa! Wuxuu ku login-yareeyay: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    // --- COMMAND: /connect ---
    if (commandName === 'connect') {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: '❌ Waxaad ka maqan tahay **Voice Channel**! Swish/Geli meel ku haboon marka hore.', flags: 64 });
      }

      joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('disconnect_btn')
          .setLabel('Kabixid (Disconnect)')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ 
        content: `✅ Bot-ka wuxuu ku soo joined-yareeyay Voice Channel-ka: **${voiceChannel.name}**`, 
        components: [row] 
      });
    }

    // --- COMMAND: /disconnect ---
    if (commandName === 'disconnect') {
      const connection = getVoiceConnection(interaction.guild.id);
      if (!connection) {
        return interaction.reply({ content: '❌ Bot-ku kuma jiro wax Voice Channel ah xilligan!', flags: 64 });
      }

      connection.destroy();
      return interaction.reply('🔌 Bot-kii waa ka baxay Voice Channel-ka.');
    }

    // --- COMMAND: /help ---
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Caawinaada Bot-ka (Help Menu)')
        .setColor('#0099ff')
        .setDescription('Halkan waxaa ku qoran amarrada aad isticmaali karto:')
        .addFields(
          { name: '/connect', value: 'Wuxuu bot-ka ku soo amrayaa Voice Channel-kaaga.' },
          { name: '/disconnect', value: 'Wuxuu bot-ka ka saarayaa Voice Channel-ka.' },
          { name: '/lyrics <song>', value: 'Wuxuu soo saarayaa lyrics-ka heesta aad raadiso.' },
          { name: '/invite', value: 'Wuxuu ku siinayaa linkiga lagu soo casuumo bot-ka.' },
          { name: '/help', value: 'Wuxuu kugu muujinayaa fariintan caawinaada ah.' }
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Taageero (Support)')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.gg/')
      );

      return interaction.reply({ embeds: [embed], components: [row] });
    }

    // --- COMMAND: /invite ---
    if (commandName === 'invite') {
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Soo Casuun Bot-ka (Invite Bot)')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl)
      );

      return interaction.reply({
        content: '🎉 Riix batoonka hoose si aad bot-ka ugu soo casuunto Server-kaaga!',
        components: [row]
      });
    }

    // --- COMMAND: /lyrics ---
    if (commandName === 'lyrics') {
      await interaction.deferReply();
      const songTitle = interaction.options.getString('song');

      try {
        // Raadinta LRCLIB API
        const response = await axios.get(`https://lrclib.net/api/search?q=${encodeURIComponent(songTitle)}`);
        const results = response.data;

        if (!results || results.length === 0 || !results[0].plainLyrics) {
          return interaction.editReply(`❌ Wax lyrics ah looma helin heesta: **${songTitle}**`);
        }

        const track = results[0];
        const rawLyrics = track.plainLyrics;

        // Ka dhigidda lyrics-ka mid noqda Subtext (`-# `) line kasta
        const formattedLyrics = rawLyrics
          .split('\n')
          .map(line => `-# ${line}`)
          .join('\n');

        // Discord embed wuxuu qaadaa 4096 xaraf ugu badnaan
        const finalLyrics = formattedLyrics.length > 4000 
          ? formattedLyrics.substring(0, 3900) + '\n-# ... (lyrics-ku waa uu ka dheeraa xadka)'
          : formattedLyrics;

        const embed = new EmbedBuilder()
          .setTitle(`🎶 Lyrics: ${track.trackName || songTitle}`)
          .setAuthor({ name: track.artistName || 'Unknown Artist' })
          .setColor('#1DB954')
          .setDescription(finalLyrics)
          .setFooter({ text: 'LRCLIB API Provider' });

        return interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error(error);
        return interaction.editReply('❌ Dhib ayaa ka dhacday marka lagu jiro raadinta lyrics-ka!');
      }
    }
  }

  // --- HANDLING BUTTON INTERACTIONS ---
  if (interaction.isButton()) {
    if (interaction.customId === 'disconnect_btn') {
      const connection = getVoiceConnection(interaction.guild.id);
      if (connection) {
        connection.destroy();
        return interaction.reply({ content: '🔌 Bot-ka waa ka baxay channel-ka.', flags: 64 });
      } else {
        return interaction.reply({ content: '❌ Bot-ku horey ayuu uga baxay channel-ka.', flags: 64 });
      }
    }
  }
});

// Shididda Bot-ka
client.login(TOKEN);
