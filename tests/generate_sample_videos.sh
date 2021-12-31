#!/bin/bash

# profiles: main main10 mainstillpicture msp main-intra main10-intra main444-8 main444-intra main444-stillpicture main422-10 main422-10-intra main444-10 main444-10-intra main12 main12-intra main422-12 main422-12-intra main444-12 main444-12-intra main444-16-intra main444-16-stillpicture
# levels : 1, 2, 2.1, 3, 3.1, 4, 4.1, 5, 5.1, 5.2, 6, 6.1, 6.2, 8.5

# https://www.bento4.com/documentation/mp4info/

# https://stackoverflow.com/a/2033417/8965434
# create 100mb ram disk on mac
# hdiutil attach -nomount ram://$((2 * 1024 * 100))
# diskutil eraseVolume HFS+ RAMDisk /dev/disk3
# disk is mounted at /Volumes/RAMDisk/

# use /dev/shm/ on linux

DIRECTORY=/Volumes/RAMDisk/

PROFILES=(main main10 mainstillpicture msp main-intra main10-intra main444-8 main444-intra main444-stillpicture main422-10 main422-10-intra main444-10 main444-10-intra main12 main12-intra main422-12 main422-12-intra main444-12 main444-12-intra main444-16-intra main444-16-stillpicture)

LEVELS=(1 2 2.1 3 3.1 4 4.1 5 5.1 5.2 6 6.1 6.2 8.5)

NO_HIGH_TIER=0 # 0|1, default 0, to allow for automatic high tier if available for profile/level combination

TAG=hev1 # hev1|hvc1, default hev1

for PROFILE in "${PROFILES[@]}"; do

  for LEVEL in "${LEVELS[@]}"; do

    echo "----------------------------------------------------------------------------------------------------"

    echo tag : "$TAG", profile : "$PROFILE", level : "$LEVEL", no_high_tier : "$NO_HIGH_TIER"

    FILENAME=${DIRECTORY}265_${TAG}_${PROFILE}_${LEVEL}.MP4

    # echo "$FILENAME"

    ffmpeg -y -loglevel quiet -nostats -f lavfi -i testsrc=size=qcif:rate=10 -an -c:v libx265 -pix_fmt yuv420p -movflags +frag_keyframe+empty_moov+default_base_moof -f mp4 -frames 100 -tag:v "$TAG" -profile:v "$PROFILE" -x265-params log-level=0:keyint=10:level-idc="$LEVEL":no-high-tier="$NO_HIGH_TIER" "$FILENAME"

    ./bento4/bin/mp4info --fast "$FILENAME" | grep "Codec String"  | sed -e 's/^[ \t]*//'

    rm "$FILENAME"

  done

done
