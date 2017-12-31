Parser that works with ffmpeg to read piped data and fragment mp4 into an initialization segment and media segments. It can also get the codec info and generate an fmp4 HLS m3u8 playlist. ***Must use the following flags with ffmpeg targeting the output***: *-f mp4 -movflags +faststart+frag_keyframe*.

Currently being used in a media source extension project @ https://github.com/kevinGodell/mse-live-player

# Options for instantiating new Mp4Frag

#### bufferSize: unsigned int (2 - 10), *setting this value will store specified number of media segments in the buffer*
`const mp4frag = new Mp4Frag({bufferSize: 3});`

#### hlsListSize: unsigned int (2 - 10), *setting this along with hlsBase will generate a live fmp4 HLS m3u8 playlist*
#### hlsBase: 'string', *setting this along with hlsListSize will generate a live fmp4 HLS m3u8 playlist*
`const mp4frag = new Mp4Frag({hlsListSize: 4, hlsBase: 'myString'});`

# Possible usage examples

## Generate a live fmp4 HLS m3u8 playlist with ffmpeg

```
const { spawn } = require('child_process');

const Mp4Frag = require('mp4frag');

const mp4frag = new Mp4Frag({hlsListSize: 3, hlsBase: 'pool'});

const ffmpeg = spawn(
    'ffmpeg',
    ['-loglevel', 'quiet', '-probesize', '64', '-analyzeduration', '100000', '-reorder_queue_size', '5', '-rtsp_transport', 'tcp', '-i', 'rtsp://131.95.3.162:554/axis-media/media.3gp', '-an', '-c:v', 'copy', '-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-metadata', 'title="ip 131.95.3.162"', '-reset_timestamps', '1', 'pipe:1'],
    {stdio: ['ignore', 'pipe', 'inherit']}
);

ffmpeg.stdio[1].pipe(mp4frag);
   
```
  * **m3u8 playlist will now be available via `mp4frag.m3u8` and can be served to a client browser via express**
  * **segments in playlist can be accessed by sequence number via `mp4frag.getHlsSegment(6)`, with `6` being the current sequence number**
#### Generated m3u8 playlist will look like the following example pulled from my live feed
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-ALLOW-CACHE:NO
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:6
#EXT-X-MAP:URI="init-pool.mp4"
#EXTINF:4.78,
pool6.m4s
#EXTINF:5.439,
pool7.m4s
#EXTINF:4.269,
pool8.m4s
```
#### Setting up some server routes to respond to http requests for playing live HLS feed
```
app.get('/pool.m3u8', (req, res) => {
    if (mp4frag.m3u8) {
        res.writeHead(200, {'Content-Type': 'application/vnd.apple.mpegurl'});
        res.end(mp4frag.m3u8);
    } else {
        res.sendStatus(503);//todo maybe send 400
    }
});

app.get('/init-pool.mp4', (req, res) => {
    if (mp4frag.initialization) {
        res.writeHead(200, {'Content-Type': 'video/mp4'});
        res.end(mp4.initialization);
    } else {
        res.sendStatus(503);
    }
});

app.get('/pool:id.m4s', (req, res) => {
    const segment = mp4frag.getHlsSegment(req.params.id);
    if (segment) {
        res.writeHead(200, {'Content-Type': 'video/mp4'});
        res.end(segment);
    } else {
        res.sendStatus(503);
    }
});
```




## Create a buffer of past video to store for later usage, possibly for recording:

```
const { spawn } = require('child_process');

const Mp4Frag = require('mp4frag');

//3 past segments will be held in buffer for later access via mp4frag.buffer
//if each segment has a duration of 2 seconds, then buffer will contain 6 seconds of video
const mp4frag = new Mp4Frag({bufferSize: 3});

const ffmpeg = spawn(
    'ffmpeg',
    ['-loglevel', 'quiet', '-probesize', '64', '-analyzeduration', '100000', '-reorder_queue_size', '5', '-rtsp_transport', 'tcp', '-i', 'rtsp://131.95.3.162:554/axis-media/media.3gp', '-an', '-c:v', 'copy', '-f', 'mp4', '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-metadata', 'title="ip 131.95.3.162"', '-reset_timestamps', '1', 'pipe:1'],
    {stdio: ['ignore', 'pipe', 'inherit']}
);

ffmpeg.stdio[1].pipe(mp4frag);
```
##### Moments later, some triggering event occurs such as motion detection and we need to record video including 6 seconds of buffered video from before motion was detected

```
const fs = require('fs');

const writeStream = fs.createWriteStream(`${Date.now()}.mp4`);

    //write in the initialization fragment of mp4 file
    writeStream.write(mp4segmenter.initialization);

    //write the buffered segments
    writeStream.write(mp4segmenter.buffer);

    //start writing the fresh segments as they arrive
    mp4segmenter.on('segment', (segment) => {
        writeStream.write(segment);
    };
    
    //eventually trigger and end to the writing
    //by removing any event or callback
    //and calling writeStream.end();
    
```    