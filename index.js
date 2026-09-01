const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActivityType,
  PermissionFlagsBits
} = require('discord.js');

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
  NoSubscriberBehavior
} = require('@discordjs/voice');

const play = require('@iamtraction/play-dl');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const players = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Ku daar hees Voice Call-ka.')
    .addStringOption(option =>
      option.setName('song').setDescription('Magaca heesta ama Link').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('connect')
    .setDescription('Bot-ka geli Voice Call-ka.'),
  new SlashCommandBuilder()
    .setName('disconnect')
    .setDescription('Bot-ka ka saar Voice Call-ka.'),
  new SlashCommandBuilder()
    .setName('invite')
    .setDescription('Soo saar linkiga loogu yeero bot-ka.'),
  new SlashCommandBuilder()
    .setName('clean')
    .setDescription('Nadiifi fariimaha channel-ka (Tirtir ilaa 100 fariimood).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Hel caawimaad ku saabsan amarrada bot-ka.')
].map(command => command.toJSON());

function formatMs(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeExp = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = timeExp.exec(line);
    if (match) {
      const minutes = parseInt(match[1]);
      const seconds = parseInt(match[2]);
      const totalMs = (minutes * 60 + seconds) * 1000;
      const text = line.replace(timeExp, '').trim();
      if (text) {
        result.push({ timeMs: totalMs, text });
      }
    }
  }
  return result;
}

function cleanSongTitle(title) {
  return title
    .replace(/\(Official Music Video\)|\(Official Video\)|\(Lyrics\)|\(Audio\)|\(HD\)|\[.*?\]|\(.*?\)|\|.*/gi, '')
    .replace(/ft\..*|feat\..*/gi, '')
    .trim();
}

async function fetchGlobalLyrics(songTitle) {
  try {
    const cleanTitle = cleanSongTitle(songTitle);
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };

    const urlLrc = `https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`;
    const resLrc = await fetch(urlLrc, { headers });
    if (resLrc.ok) {
      const dataLrc = await resLrc.json();
      if (Array.isArray(dataLrc) && dataLrc.length > 0) {
        const syncedMatch = dataLrc.find(i => i.syncedLyrics);
        if (syncedMatch) return parseLrc(syncedMatch.syncedLyrics);

        const plainMatch = dataLrc.find(i => i.plainLyrics);
        if (plainMatch) {
          const lines = plainMatch.plainLyrics.split('\n').filter(l => l.trim() !== '');
          return lines.map((text, idx) => ({ timeMs: idx * 4000, text }));
        }
      }
    }
    return null;
  } catch (error) {
    return null;
  }
}

function createProgressBar(currentMs, totalDurationStr) {
  const parts = totalDurationStr.split(':');
  let totalMs = 0;
  if (parts.length === 2) {
    totalMs = (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
  } else if (parts.length === 3) {
    totalMs = (parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])) * 1000;
  }

  if (!totalMs || totalMs === 0) return '`[🔘▬▬▬▬▬▬▬▬▬▬]`';

  const progress = Math.min(Math.max(currentMs / totalMs, 0), 1);
  const size = 10;
  const currentPos = Math.round(size * progress);

  let bar = '';
  for (let i = 0; i <= size; i++) {
    if (i === currentPos) {
      bar += '🔘';
    } else {
      bar += '▬';
    }
  }

  return `\`[${bar}]\` \`${formatMs(currentMs)} / ${totalDurationStr}\``;
}

function createMusicEmbed(musicData, isEnded = false) {
  const song = musicData.current;
  if (!song) return null;

  const loopStatus = musicData.loop === 'song' ? '🔂 On' : '❌ Off';
  const volumePercent = Math.round(musicData.volume * 100);
  const playbackMs = musicData.resource?.playbackDuration || 0;

  const progressBar = isEnded 
    ? `\`[▬▬▬▬▬▬▬▬▬▬🔘]\` \`${song.duration} / ${song.duration}\``
    : createProgressBar(playbackMs, song.duration);

  let prevLine = '';
  let currentLine = isEnded ? '🏁 Heestii waa dhammatay.' : '(Lyrics lama helin)...';
  let nextLine = '';

  if (!isEnded && song.parsedLyrics && song.parsedLyrics.length > 0) {
    let activeIdx = -1;
    for (let i = 0; i < song.parsedLyrics.length; i++) {
      if (playbackMs >= song.parsedLyrics[i].timeMs) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== -1) {
      currentLine = song.parsedLyrics[activeIdx].text;
      if (activeIdx > 0) prevLine = song.parsedLyrics[activeIdx - 1].text;
      if (activeIdx < song.parsedLyrics.length - 1) nextLine = song.parsedLyrics[activeIdx + 1].text;
    } else if (song.parsedLyrics.length > 0) {
      nextLine = song.parsedLyrics[0].text;
    }
  }

  let lyricsDisplay = '';
  if (prevLine) lyricsDisplay += `-# ${prevLine}\n`;
  lyricsDisplay += `<a:Lyrics:1544108985609625660> **${currentLine}**`;
  if (nextLine) lyricsDisplay += `\n-# ${nextLine}`;

  const endStatusText = isEnded ? '\n\n🔴 **[ END ]**' : '';

  const embed = new EmbedBuilder()
    .setTitle(isEnded ? `🎧 FINISHED` : `🎧 NOW PLAYING <a:nsucii:1544103175261397023>`)
    .setDescription(
      `<:muscineme:1544138724777136219> **[${song.title}](${song.url})**\n\n` +
      `<a:time:1544108938457518140> ${progressBar}\n` +
      `<a:veluem:1544109177704816690> \`${volumePercent}%\` | 🔁 **Loop:** \`${loopStatus}\`\n\n` +
      `${lyricsDisplay}` +
      `${endStatusText}`
    )
    .setColor(isEnded ? '#2f3136' : '#ff007f');

  if (song.thumbnail) embed.setThumbnail(song.thumbnail);
  return embed;
}

function createMusicButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pause_resume_btn').setLabel('Pause / Resume').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('skip_song_btn').setLabel('Skip').setEmoji('⏩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('loop_toggle_btn').setLabel('Loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('volume_modal_btn').setLabel('Volume').setEmoji('🔊').setStyle(ButtonStyle.Success)
    )
  ];
}

async function updateMusicMessage(musicData) {
  if (!musicData.message || !musicData.current) return;
  try {
    const embed = createMusicEmbed(musicData);
    if (!embed) return;
    await musicData.message.edit({ embeds: [embed], components: createMusicButtons() });
  } catch (error) {}
}

async function handleSongEnd(guildId) {
  const musicData = players.get(guildId);
  if (!musicData) return;

  if (musicData.lyricsInterval) {
    clearInterval(musicData.lyricsInterval);
    musicData.lyricsInterval = null;
  }

  if (musicData.message && musicData.current) {
    try {
      const endEmbed = createMusicEmbed(musicData, true);
      await musicData.message.edit({ embeds: [endEmbed], components: [] });
    } catch (e) {}
  }
}

async function playNext(guildId) {
  const musicData = players.get(guildId);
  if (!musicData) return;

  await handleSongEnd(guildId);

  if (musicData.loop === 'song' && musicData.current) {
    return playSong(guildId, musicData.current);
  }

  if (musicData.queue.length === 0) {
    musicData.current = null;
    return;
  }

  const nextSong = musicData.queue.shift();
  await playSong(guildId, nextSong);
}

async function playSong(guildId, song) {
  const musicData = players.get(guildId);
  if (!musicData || !song) return;

  try {
    musicData.current = song;

    if (!song.parsedLyrics) {
      song.parsedLyrics = await fetchGlobalLyrics(song.title);
    }

    const stream = await play.stream(song.url);
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
      inlineVolume: true
    });

    resource.volume.setVolume(musicData.volume);
    musicData.resource = resource;
    musicData.player.play(resource);

    await updateMusicMessage(musicData);

    if (musicData.lyricsInterval) clearInterval(musicData.lyricsInterval);

    musicData.lyricsInterval = setInterval(() => {
      if (musicData.player.state.status === AudioPlayerStatus.Playing) {
        updateMusicMessage(musicData).catch(() => {});
      }
    }, 1000);

  } catch (error) {
    console.error('PLAY ERROR:', error);
    await playNext(guildId);
  }
}

function createMusicPlayer(guildId, connection) {
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Play }
  });

  const musicData = {
    player,
    connection,
    resource: null,
    current: null,
    queue: [],
    volume: 1.0,
    loop: 'off',
    message: null,
    lyricsInterval: null
  };

  players.set(guildId, musicData);

  player.on(AudioPlayerStatus.Idle, async () => {
    await playNext(guildId);
  });

  return musicData;
}

client.once('ready', async () => {
  console.log(`✅ Bot Online: ${client.user.tag}`);
  client.user.setActivity('/play | Music', { type: ActivityType.Listening });

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commands Loaded!');
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;

  try {
    if (interaction.isChatInputCommand()) {
      const { commandName } = interaction;

      if (commandName === 'play') {
        const songQuery = interaction.options.getString('song')?.trim();
        const voiceChannel = interaction.member.voice.channel;

        if (!voiceChannel) {
          return interaction.reply({ content: '❌ Horta gal Voice Call!', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply();

        const results = await play.search(songQuery, { limit: 1, source: { youtube: 'video' } });
        if (!results || results.length === 0) return interaction.editReply('❌ Hees lama helin!');

        const video = results[0];
        const song = {
          title: video.title,
          url: video.url,
          thumbnail: video.thumbnails?.at(-1)?.url || '',
          duration: video.durationRaw || 'Unknown',
          parsedLyrics: null
        };

        let connection = getVoiceConnection(interaction.guild.id);
        if (!connection) {
          connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: true
          });
          await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        }

        let musicData = players.get(interaction.guild.id);
        if (!musicData) {
          musicData = createMusicPlayer(interaction.guild.id, connection);
          connection.subscribe(musicData.player);
        }

        if (musicData.current) {
          musicData.queue.push(song);
          return interaction.editReply(`➕ **${song.title}** Safka ayaa lagu daray!`);
        }

        await playSong(interaction.guild.id, song);
        const embed = createMusicEmbed(musicData);
        await interaction.editReply({ embeds: [embed], components: createMusicButtons() });
        musicData.message = await interaction.fetchReply();
      }

      else if (commandName === 'connect') {
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) return interaction.reply({ content: '❌ Horta gal Voice Call!', flags: MessageFlags.Ephemeral });

        joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: interaction.guild.id,
          adapterCreator: interaction.guild.voiceAdapterCreator,
          selfDeaf: true
        });

        return interaction.reply(`🎤 Bot-ku wuxuu ku xirmay: **${voiceChannel.name}**`);
      }

      else if (commandName === 'disconnect') {
        const connection = getVoiceConnection(interaction.guild.id);
        if (connection) connection.destroy();
        const musicData = players.get(interaction.guild.id);
        if (musicData?.lyricsInterval) clearInterval(musicData.lyricsInterval);
        players.delete(interaction.guild.id);
        return interaction.reply('👋 Bot-kii waa ka baxay Voice Call-ka.');
      }

      else if (commandName === 'invite') {
        const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands`;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel('Add to Discord').setStyle(ButtonStyle.Link).setURL(inviteUrl)
        );
        return interaction.reply({ content: '🔗 **Ku soo dar Bot-ka Server-kaaga:**', components: [row] });
      }

      else if (commandName === 'clean') {
        await interaction.channel.bulkDelete(100, true).catch(() => {});
        return interaction.reply({ content: '🧹 Channel-ka waa la nadiifiyay!', flags: MessageFlags.Ephemeral });
      }

      else if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📖 Help Menu')
          .setDescription(
            '`/play <song>` - Ku daar hees Voice Call-ka\n' +
            '`/connect` - Bot-ka ku xir Voice Call\n' +
            '`/disconnect` - Bot-ka bixi Voice Call\n' +
            '`/clean` - Nadiifi fariimaha channel-ka\n' +
            '`/invite` - Soo saar linkiga bot-ka\n' +
            '`/help` - Liiska amarrada'
          )
          .setColor('#00ff7f');
        return interaction.reply({ embeds: [embed] });
      }
    }

    if (interaction.isButton()) {
      const musicData = players.get(interaction.guild.id);
      if (!musicData || !musicData.current) {
        return interaction.reply({ content: '❌ Wax hees ah ma socoto!', flags: MessageFlags.Ephemeral });
      }

      if (interaction.customId === 'pause_resume_btn') {
        if (musicData.player.state.status === AudioPlayerStatus.Paused) {
          musicData.player.unpause();
          await interaction.reply({ content: '▶️ Waa la sii waday', flags: MessageFlags.Ephemeral });
        } else {
          musicData.player.pause();
          await interaction.reply({ content: '⏸️ Waa la hakiyay', flags: MessageFlags.Ephemeral });
        }
      }

      else if (interaction.customId === 'skip_song_btn') {
        musicData.player.stop();
        await interaction.reply({ content: '⏩ Lagu dhaafay!', flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId === 'loop_toggle_btn') {
        musicData.loop = musicData.loop === 'song' ? 'off' : 'song';
        await updateMusicMessage(musicData);
        await interaction.reply({ content: `🔁 Loop: **${musicData.loop.toUpperCase()}**`, flags: MessageFlags.Ephemeral });
      }

      else if (interaction.customId === 'volume_modal_btn') {
        const modal = new ModalBuilder()
          .setCustomId('volume_modal')
          .setTitle('Beddel Volume-ka');

        const volumeInput = new TextInputBuilder()
          .setCustomId('vol_input')
          .setLabel('Geli Volume (1 - 100)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('50')
          .setRequired(true);

        const row = new ActionRowBuilder().addComponents(volumeInput);
        modal.addComponents(row);

        await interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'volume_modal') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const musicData = players.get(interaction.guild.id);
        if (!musicData) {
          return interaction.editReply({ content: '❌ Wax hees ah ma socoto!' });
        }

        const val = parseInt(interaction.fields.getTextInputValue('vol_input'));
        if (isNaN(val) || val < 1 || val > 100) {
          return interaction.editReply({ content: '❌ Geli nambar u dhexeeya 1 ilaa 100!' });
        }

        musicData.volume = val / 100;
        if (musicData.resource?.volume) {
          musicData.resource.volume.setVolume(musicData.volume);
        }

        await updateMusicMessage(musicData);
        return interaction.editReply({ content: `🔊 Volume waxaa loo beddelay **${val}%**` });
      }
    }

  } catch (err) {
    console.error(err);
  }
});

client.login(TOKEN);
