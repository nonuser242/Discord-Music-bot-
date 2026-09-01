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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const TOKEN = process.env.TOKEN ||
const CLIENT_ID = process.env.CLIENT_ID ||

const commands = [
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
    console.log('Bilaabida diwaangelinta amarrada...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log('Amarrada waa lagu guuleystay!');
  } catch (error) {
    console.error('Dhib ayaa ka dhacday amarrada:', error);
  }
})();

client.once('ready', () => {
  console.log(`✅ Bot Online: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

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

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('disconnect_btn')
          .setLabel('Ka bixid')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({ 
        content: `✅ Bot-ku wuxuu ku xirmay: **${voiceChannel.name}**`, 
        components: [row] 
      });
    }

    if (commandName === 'disconnect') {
      const connection = getVoiceConnection(interaction.guild.id);
      if (!connection) {
        return interaction.reply({ content: '❌ Bot-ku kuma jiro Voice Call!', flags: 64 });
      }

      connection.destroy();
      return interaction.reply('🔌 Bot-kii waa ka baxay Voice Call-ka.');
    }

    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Help Menu')
        .setColor('#0099ff')
        .setDescription('Amarrada aad isticmaali karto:')
        .addFields(
          { name: '/connect', value: 'Bot-ka ku xir Voice Call.' },
          { name: '/disconnect', value: 'Bot-ka ka saar Voice Call.' },
          { name: '/lyrics <song>', value: 'Soo saar lyrics-ka heesta.' },
          { name: '/invite', value: 'Soo saar linkiga bot-ka.' },
          { name: '/help', value: 'Liiska amarrada.' }
        );

      return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'invite') {
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('Add to Discord')
          .setStyle(ButtonStyle.Link)
          .setURL(inviteUrl)
      );

      return interaction.reply({
        content: '🔗 Riix batoonka si aad bot-ka ugu soo casuunto Server-kaaga:',
        components: [row]
      });
    }

    if (commandName === 'lyrics') {
      await interaction.deferReply();
      const songTitle = interaction.options.getString('song');

      try {
        const response = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(songTitle)}`);
        
        if (!response.ok) {
          return interaction.editReply('❌ Dhib ayaa ka dhacday raadinta lyrics-ka!');
        }

        const results = await response.json();

        if (!results || results.length === 0 || !results[0].plainLyrics) {
          return interaction.editReply(`❌ Wax lyrics ah looma helin heesta: **${songTitle}**`);
        }

        const track = results[0];
        const rawLyrics = track.plainLyrics;

        const formattedLyrics = rawLyrics
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
        return interaction.editReply('❌ Dhib ayaa ka dhacday marka lagu jiro raadinta lyrics-ka!');
      }
    }
  }

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

client.login(TOKEN);

