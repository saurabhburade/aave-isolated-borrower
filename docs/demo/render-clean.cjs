const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn, execFileSync} = require('node:child_process');

const root = __dirname;
const raw = path.join(root, 'raw-4k');
const outputDir = path.join(raw, 'rendered');
const sourceVideo = path.join(raw, 'capture.webm');
const modalScenes = new Set([
  '06-review',
  '07-create-a',
  '09-create-b',
  '11-manage',
  '12-add-confirmed',
  '13-repay',
  '14-repay-confirmed',
]);

function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {stdio: ['ignore', 'ignore', 'pipe']});
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve()
      : reject(new Error(`${executable} exited ${code}\n${stderr}`)));
  });
}

function escapeMetadata(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('=', '\\=').replaceAll(';', '\\;').replaceAll('#', '\\#').replaceAll('\n', '\\n');
}

(async () => {
  const edit = JSON.parse(await fs.readFile(path.join(root, 'edit.json'), 'utf8'));
  const timeline = JSON.parse(await fs.readFile(path.join(raw, 'timeline.json'), 'utf8'));
  const mediaInfo = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', sourceVideo,
  ], {encoding: 'utf8'}));
  const videoStream = mediaInfo.streams?.[0];
  if (videoStream?.width !== 3840 || videoStream?.height !== 2160) {
    throw new Error(`Expected 3840x2160 raw capture; got ${videoStream?.width}x${videoStream?.height}`);
  }

  await fs.mkdir(outputDir, {recursive: true});
  const clipsDir = path.join(outputDir, 'clips');
  await fs.mkdir(clipsDir, {recursive: true});
  const rendered = [];
  const chapterLines = [
    ';FFMETADATA1',
    `title=${escapeMetadata(edit.title || 'Aave isolated positions — post-research PoC')}`,
    'artist=saurabh_evm',
    'comment=Clean app-only capture from native local-fork transactions.',
  ];
  let elapsed = 0;

  for (const scene of edit.scenes) {
    const matches = timeline.scenes.filter(item => item.name === scene.name);
    const source = scene.occurrence === undefined ? matches.at(-1) : matches[scene.occurrence];
    if (!source) throw new Error(`Missing timeline scene ${scene.name}`);
    const sourceLength = source.end - source.start;
    if (!(sourceLength > 0)) throw new Error(`Invalid source interval for ${scene.name}`);

    let filter;
    if (scene.skipWait && sourceLength > scene.duration) {
      const first = Math.min(2.7, scene.duration * 0.35);
      const last = scene.duration - first - 0.4;
      const secondStart = Math.max(first, sourceLength - last);
      filter = `[0:v]split=2[a][b];` +
        `[a]trim=start=0:end=${first},setpts=PTS-STARTPTS[a1];` +
        `[b]trim=start=${secondStart}:end=${sourceLength},setpts=PTS-STARTPTS[b1];` +
        `[a1][b1]concat=n=2:v=1:a=0[cut];` +
        `[cut]tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},fps=${edit.fps}[timed]`;
    } else {
      const speed = sourceLength > scene.duration ? sourceLength / (scene.duration - 0.3) : 1;
      filter = `[0:v]trim=duration=${sourceLength},setpts=(PTS-STARTPTS)/${speed},` +
        `tpad=stop_mode=clone:stop_duration=${scene.duration},trim=duration=${scene.duration},fps=${edit.fps}[timed]`;
    }

    // Raw capture coordinates are physical pixels (CSS viewport at DPR 2).
    // The wide view trims only the app's horizontal excess to reach 16:9.
    // Modal views use the central app dialog for legible controls.
    const crop = modalScenes.has(scene.name)
      ? 'crop=2112:1188:864:456'
      : 'crop=3022:1700:409:200';
    filter += `;[timed]${crop},scale=3840:2160:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p,setparams=range=limited[out]`;

    const clip = path.join(clipsDir, `${scene.name}.mp4`);
    await run('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(source.start), '-i', sourceVideo,
      '-filter_complex', filter, '-map', '[out]', '-an', '-t', String(scene.duration),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-profile:v', 'high', '-level:v', '5.1',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(edit.fps), '-fps_mode', 'cfr',
      '-movflags', '+faststart', clip,
    ]);

    rendered.push(clip);
    chapterLines.push(
      '[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(elapsed * 1000)}`,
      `END=${Math.round((elapsed + scene.duration) * 1000)}`,
      `title=${escapeMetadata(scene.chapter || scene.name)}`,
    );
    elapsed += scene.duration;
    console.log(`RENDERED ${scene.name} ${scene.duration}s ${modalScenes.has(scene.name) ? 'modal crop' : 'app crop'}`);
  }

  const concatList = path.join(outputDir, 'concat.txt');
  await fs.writeFile(concatList, rendered.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n');
  const metadataFile = path.join(outputDir, 'chapters.txt');
  await fs.writeFile(metadataFile, chapterLines.join('\n') + '\n');

  const output4k = path.join(root, 'aave-isolated-positions-poc-4k.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
    '-i', metadataFile, '-map', '0:v:0', '-map_metadata', '1', '-map_chapters', '1',
    '-c:v', 'copy', '-color_range', 'tv', '-movflags', '+faststart', output4k,
  ]);

  const output1080 = path.join(root, 'aave-isolated-positions-poc-1080p.mp4');
  await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', output4k,
    '-map', '0:v:0', '-map_metadata', '0', '-map_chapters', '0',
    '-vf', 'scale=1920:1080:flags=lanczos:in_range=tv:out_range=tv,format=yuv420p,setparams=range=limited',
    '-an', '-r', String(edit.fps), '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14',
    '-profile:v', 'high', '-level:v', '4.1', '-pix_fmt', 'yuv420p', '-color_range', 'tv',
    '-movflags', '+faststart', output1080,
  ]);

  console.log(`EXPORTED ${output4k} and ${output1080} (${elapsed}s, ${edit.scenes.length} scenes)`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
