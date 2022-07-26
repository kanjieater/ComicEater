# ComicEater
A collection of utilities for comic book archive management. Currently this is in alpha testing (AKA perfectly stable for me but YMMV).

<img src="https://i.imgur.com/wUoSO0C.png" width="150"/>

Including the following:
- Supports Rar, Rar5, Zip, 7z, CBZ, CBR
- Verify archives aren't corrupt using 7Zip
- Verify images aren't corrupt using ImageMagick
- Option to upscale comic books with machine learning to higher resolutions using waifu2x-ncnn-vulkan
- Option to remove white space on margins
- Option to split double pages into individual pages
- Download metadata (from sources like AniList) for use in Komga (stored in a `ComicInfo.xml` )
- Download covers for use Komga
- Converts all of your archives to the standard CBZ, comic book zip format
- Rename and group files according to downloaded metadata
- Split nested archives into individual archives
- Intelligently split archives based on volume count, eg a single archive named Jojo v1-3 could be split into 3 separate archives
- Convert a folder of images into an archive - intelligently splitting them according to their volume number
- Easy to understand pattern matching to standardize naming across your library
- Conversion of archives into individual folders so they can be be recognized as a series in Komga
- Removes distributer bloat, like url file links to their site
- Supports a Queue folder that can be used to automatically convert archives on a chron job
- Moves failed conversions to a maintenance folder so you can manually fix and rerun any failed jobs
- Records file history inside the archive as `ComicEater.json` to show what it was renamed from, split from, etc. and for future possibilities, like reverting changes

# Table of Contents

* [Support](#support)
* [Install](#install)
* [Commands](#commands)
* [Maintain Collection](#maintain-collection) 
* [Convert to Series](#convert-to-series) 
* [Suggest Naming](#suggest-naming) 
* [Download Covers](#download-covers) 
* [Enhancement Options](#enhancement-options)  
* [Config](#config) 

# Examples
## Upscale before and after:

<img src="https://i.imgur.com/xKXGaoD.jpg" width="200"> <img src="https://i.imgur.com/cIAFrjJ.png" width="400">

For a more accurate comparison view [here](https://imgsli.com/NzQ1Njk).

## White space trim:

<img src="https://i.imgur.com/hz3JYeC.jpg" width="400"> <img src="https://i.imgur.com/dQ8BXQD.jpg" width="400">

## Double page split and white space trim:

<img src="https://i.imgur.com/Lk0HvaC.jpg" width="400">

It keeps the inner margin in tact, to indicate which page is the inner book binding. [Here](https://twitter.com/kanjieater/status/1299776511252353031)'s an inner book binding example I tweeted about.

<img src="https://i.imgur.com/SLGLBOR.jpg" width="200">&nbsp;<img src="https://i.imgur.com/BI3tY8h.jpg" width="200">

## Converts nested archives
Original archive:
<img src="https://i.imgur.com/asRv5B8.png" width="200">

Split archive with downloaded covers:

<img src="https://i.imgur.com/p9cYOza.png" width="800">

Archives read as series in Komga now with metadata from AniList:

<img src="https://i.imgur.com/890oOKx.png" width="800">

Archives read as series in Tachiyomi now with Komga:

<img src="https://i.imgur.com/lUEBDaM.jpg" width="400">


# Support

If you're into this sort of thing, you might be interested in my podcast or the games I stream:

<a href="https://www.youtube.com/channel/UCU1cAd9sJ4HeiBDsjnmifAQ"><img src="https://i.imgur.com/DLNKUcz.png" title="YouTube" width="50" /></a>
&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://twitter.com/kanjieater"><img src="https://i.imgur.com/KoLnQAl.png" title="twitter"  width="50" /></a>
&nbsp;&nbsp;&nbsp;&nbsp;
<a href="https://www.twitch.tv/kanjieater"><img src="https://i.imgur.com/sGLxgeo.png" title="twitch"  width="50" /></a>
&nbsp;&nbsp;&nbsp;&nbsp;

You can get support here: [Discord](https://discord.com/invite/agbwB4p)

If you find my tools useful please consider supporting via Patreon.

<a href="https://www.patreon.com/kanjieater" rel="nofollow"><img src="https://i.imgur.com/VCTLqLj.png"></a>





# Install
The apps current state requires both Windows and WSL.

The app currently only supports being run from the source code, though I'm open to pull-requests to dockerize it or remove the windows dependency. All dependencies are WSL specific, but all paths are input as Windows paths for convenience.

The base functionality requires the following to be installed:

`sudo apt-get install p7zip imagemagick unrar`

Also make sure the version of Node.js specified in the `.nvmrc ` (found in the project root) is installed. Currently this is `16.6.2`. I recommend using [nvm](https://github.com/nvm-sh/nvm).

Install `yarn`:

`npm install --global yarn`

In the project root folder execute:

`yarn`

Puppeteer is also an internal requirement for downloading cover images, so your system may require additional dependencies. On Ubuntu 20.04 i had to install these:

`sudo apt install -y libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxi-dev libxtst-dev libnss3 libcups2 libxss1 libxrandr2 libasound2 libatk1.0-0 libatk-bridge2.0-0 libpangocairo-1.0-0 libgtk-3-0 libgbm1`

Customize your config file. I highly recommend reading through the [#config] section and then downloading [my config](https://gist.github.com/kanjieater/e617a0f370edf25e0f947a25d67ba8ec), and adjust it as needed. This is the only part you should have to use your brain on ;).

You can now run any of the commands below from WSL!

## Warning

- I recommend running the commands from `bash`, not `zsh`, as `zsh` can crash WSL when run for long periods with a lot of text output.
- Make sure you have a backup of any archives you put in your queueFolders. I've run this with hundreds of archives now, so it does work well, but there could be bugs. I make no guarantees it will work well for you.

# Commands
# CLI Logging
You can use the `-v` command with any command to change the log level. Move v's is more verbose. I recommend running all commands with `-vv` to see `info` logging, so you can see how many succeeded and at what steps.

Error's should always be logged.

`-v`: Shows `WARN` level

`-vv`: Shows `INFO` level

`-vvv`: Shows `DEBUG` level

# Maintain Collection
## Description
This is meant to be run as a service and will rerun based on `scanCron` in seconds.
It convert archives from the `seriesFolders`'s `queueFolders` to CBZ's. Then converts them to series and updates their metadata.
### Option
`--configFile`
`--maintainCollection`
`--offline`: Don't download metadata or use downloaded metadata for file renaming

Download Cover options are also valid.

Enhancement options are also valid.

### Template
`yarn main --configFile "<configFile>" --maintainCollection`
### Example
`yarn main -vv --configFile "W:\Collection\ComicEater.test.yml" --maintainCollection`


### Flow
1. ☑ Get all archives at `queueFolders`
1. ☑ Convert them to CBZ (See the `Convert to CBZ Flow`)
1. ☑ Use `folderPatterns` to gather metadata from the folder about the files
1. ☑ Use the `filePatterns` to gather data about the files
1. ☑ Search remote sources for any additional metadata
1. ☑ Download Covers
1. ☑ Rename the archive according to the metadata and `comic.json`'s `outputNamingConventions`
1. ☑ Update `ComicEater.json` and `ComicInfo.xml` with available metadata in the archive

#### Convert to CBZ Flow
1. ☑ Get all archives from the path (if `maintainCollection`, this will be your queueFolders)
1. ☑ Get all image folders in path
1. ☑ Test that the archives are valid archives with `7z t`
1. ☑ Get `volumeRange` from `filePatterns` to infer if multiple volumes are present
1. ☑ Extract archive in current directory
1. ☑ Recursively check for nested archives, and apply each of the following steps to each archive.
1. ☑ Remove archive distributer bloat per user config (links to tracker etc.)
1. ☑ Validate that there are images present in extracted archives
1. ☑ Validate that images are valid using ImageMagick by doing a transform to a 5x5 image - Currently requires writing them to a `/tmp/` directory that is automatically cleaned up after the test is run
1. ☑ If multiple volumes are present, see if the parent of the image containing subfolder count matches, and if it does, consider each subfolder as a separate volume
1. ☑ If `--trimWhiteSpace` is present, run trim through imagemagick
1. If `--upscale` is present, run the content through waifu2x
1. ☑ If `--splitPages` is present, cut each page into two
1. ☑ Repack images
1. ☑ If nested archives exist, flatten all nested archives in place of the original
1. ☑ If there were no errors, remove the extracted working directory
1. ☑ Update `ComicEater.json` with available metadata (history) in the archive


# Convert to Series
## Description
This is useful for when your archives have already been validated but you want to manually change a series title (maybe it downloaded the wrong one off Anilist). It moves CBZ's to Series folders and update their metadata based on local file and folder patterns. Your archives must already be valid CBZs.
### Option
`--configFile`

`--convertToSeries`

`--offline`

Download Cover options are also valid.

### Example
`yarn main -vv --configFile 'W:\Collection\ComicEater.yml' --convertToSeries`

### Flow
1. ☑ Get all archives at `queueFolders` path
1. ☐ Get any metadata available from the `ComicEater.json` file
1. ☑ Infer each seriesRoot level archives series from file if no existing metadata
1. ☑ Get metadata from remote sources
1. ☑ Name the series according to the available metadata
1. ☑ Put archives in their seriesRoot series folder according to the config
1. ☑ Rename the archive according to the metadata and configuration rules
1. ☑ Download images for each volume and place in the series folder
1. ☑ Update `ComicEater.json` and `ComicInfo.xml` with available metadata in the archive

# Suggest Naming
## Description
This makes no changes to archives. This is useful for when you want to see what ComicEater would rename your archive to. Currently, it won't be able to predict how nested archives or volumes would be extracted.
### Option
`--configFile`

`--convertToSeries`

`--offline`

Download Cover options are also valid.

### Example
`yarn main -vv --configFile 'W:\Collection\ComicEater.yml' --suggestNaming`

# Download Covers
## Description
Downloads covers for each volume and places it in the series
### Option
`--downloadCover` Expects a path. If none is given, then it will use the series path of each individual series in the job.
`--coverQuery "site:bookmeter.com 血界戦線 -Back"`

Sometimes it may download the wrong series image even with the validation. For instance the sequel to the manga `血界戦線`, is `血界戦線 back 2 back`. `血界戦線` is still in the name and considered valid. If you want to ignore the sequel you manually run `--coverQuery "site:bookmeter.com 血界戦線 -Back"`. Google will then exclude the sequels results containing `Back`.

`--noCoverValidate`

Sometimes the validation will fail if a manga is named something like BEASTARS, but google only found results containing ビースターズ. If you know the query will work, then you can use the `--noCoverValidate` to force the first image found in Google's results to be downloaded.

### Example
`yarn main -vv --configFile 'W:\Collection\ComicEater.yml' --getCovers --downloadCover "W:\Collection\シリーズ"`


### Flow
1. ☑ Get all archives at `queueFolders` path
1. ☑ Get metadata from online sources and local sources
1. ☑ Query using `coverQuery`. This defaults to `<volumeNumber> <seriesName> <authors> site:bookmeter.com` (You can see this result for yourself on Google Images)
1. ☑ If `--noCoverValidate` is not present, then validate that the cover's title on Google Images has the correct volume number and series name is present
1. ☑ Downloads the cover to the `--downloadCover` path with the same name as the volume



# Enhancement Options
## Upscale
### Option
`--upscale`
### Description
Runs waifu2x on all images in the archive, and repacks then with their upscaled version. Currently supports `-n 2 -s 2`, a setting of 2 denoise level and 2x scale factor. See [here](https://github.com/nihui/waifu2x-ncnn-vulkan) for more details.
### Setup
Currently, upscaling relies on having `waifu2x-ncnn-vulkan.exe` on your path. You can get the most recent release from [here](https://github.com/nihui/waifu2x-ncnn-vulkan/releases).

I recommend first trying that a command to waifu2x works, something like this:

`waifu2x-ncnn-vulkan.exe -i "W:\\Collection\\SomeFolderWithImages" -o "W:\\Collection\\SomeOutputFolder\\" -n 2 -s 2`

NOTE: This program will run as fast as your hardware. It's best if you can confirm it's using your GPU.

If you can get this command working with `waifu2x-ncnn-vulkan.exe` on your path, the WSL app can call out to it.


## Trim White Space
### Option
`--trimWhiteSpace`

Trims white space using GraphicsMagick's trim option. It uses a fuzz factor of `10` so that border colors that are roughly the same color can be properly trimmed. See [here](http://www.graphicsmagick.org/GraphicsMagick.html#details-trim) for more details.

## Split Double Pages
### Option
`--splitPages`

Cut's pages in half. If Trim White Space option is included, it will wait until after the trim is done. Assumes right to left currently. 

# Setting Metadata
## Description
Inside the app there are 3 ways of thinking about metadata.
1. metadata about the archive itself (History)
1. metadata about the content (Series, Volume, etc.)
1. metadata about the pipelines progress (Context: Internal runtime info of the pipelines "saga" work)
Only the Archive metadata & Content metadata get persisted to the archive. Though pieces of the Context metadata may be embedded inside of History in order to allow for "rollbacks".

# Config
## Descriptions
Every time you run a command you give the app a `.yml` config file. I personally use one for automated things that I run on a nightly automated task (like converting weekly subscription magazines automatically), and a second config file for manual runs.

There's a lot here, so the easiest way to understand it is to read this, then spend less than 10 mins, trying to understand my real config [here](https://gist.github.com/kanjieater/e617a0f370edf25e0f947a25d67ba8ec). If you have difficulty still you can ask for help on discord.

## Patterns
The pattern matching uses the double curly brace syntax `{{metaDataVariableName}}` as a way to indicate where metadata is at.
The pattern matching also uses [glob](https://en.wikipedia.org/wiki/Glob_(programming))-like syntax to allow for subfolder matching. (I never use more than one folder level deep though personally). So something like `{{seriesName}}/**/*` matches the top level folder name as the `seriesName`, and no sub-folders would be used in the metadata.
### Getting Metadata
The `folderPatterns` and `filePatterns` use custom pattern matching to know how to infer metadata from your file names and folders. They use an ordered list, and will take the top pattern it can match with all variables in the pattern.
So if you a file named `[Bob] MyManga v01`, and file patterns of
- `"VerySpecifcPattern[{{authors}}] {{seriesName}} {{volumeNumber}}"`
- `"[{{authors}}] {{seriesName}} v{{volumeNumber}}"`
- `"{{seriesName}}"`
It will automatically infer the author is Bob and the series name should be MyManga, and it contains the first volume.Since the top pattern would not match, it would ignore it (VerySpecificPattern wasn't found in the file name `[Bob] MyManga v01`). Since the `[]` of the `authors` pattern and the space before teh `seriesName` and the `v` of the `volumeNumber` were present it matched the second pattern.

If instead the file had been named `Bob's standalone Manga`, it would match the third pattern, giving it a series name of `Bob's standalone Manga`. The author would not be inferred, and the volume number would also be unknown.

### Outputting
Based on the metadata picked up from the file & folder patterns, as well as the metadata gained from external sources like AniList, it will use the `outputNamingConventions` as a prioritized list of ways to name your files. It will not use a pattern unless ALL metadata variables were matched (besides `fileName`, which can be used as a default).

- `"{{seriesRoot}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeRange}}巻"`
- `"{{seriesRoot}}{{seriesName}}/[{{authors}}] {{seriesName}} - 第{{volumeNumber}}{{volumeVariant}}巻"`
- `"{{seriesRoot}}{{fileName}}/{{fileName}}"`

The first output pattern would match if `[Bob] MyManga v1-4` wasn't able to be automatically split, and therefore had a `volumeRange`.
The second pattern would be matched if a volume had a single letter after it, as is common in manga distribution:
`[Bob] MyManga v1e`, and would result in: `/YourSeriesRoot/MyManga/[Bob] MyManga - 第1e巻`.
The last case would be a fallback to keeping whatever the files original name was, in case the other metadata variables couldn't be found.

### Recognized Metadata variables
#### Input and Output metadata Variables
- `{{authors}}` : the default author will be assumed to be the writer in Komga metadata. They will be split by `splitAuthorsBy`, so `Bob・KanjiEater` could be split into two separate authors: Bob & Kanjieater.
- `{{volumeNumber}}`: Runs it through various validation checks to assure it's actually a number, and also extracts a `volumeVariant`, which is at most one letter attached to the volume number. It can also recognize volume ranges, eg `c2-5`. Chapters and volumes are used without distinction currently.
- `{{publishYear}}`: Any characters
- `{{publishMonth}}`: Any characters
- `{{publishDate}}`: Any characters
#### Output only
- `{{seriesRoot}}`: The folder from the `seriesRoot`
- `{{fileName}}`: The original file name

## Clean up
- `filesToDeleteWithExtensions` will remove any files in the archive that have a matching file extension. (Common use case `someAwfulSite.url`)
- `junkToFilter` will remove these patterns from your file names and folder names
## Metadata
You can set default metadata according to the accepted comicInfo.xml fields for komga in the `defaults`:
  ```
  defaults:
    contentMetaData:
      languageISO: ja
      manga: YesAndRightToLeft
  ```
Setting your language to ja will assume you want Japanese text in file names, instead of an English translation.


## Maintenance Folder
- `maintenanceFolder`

This is used when something goes wrong. All failed files are moved here.


# Potential Future Features
1. ~~File names w/ spaces breaks spawn~~
1. ~~Saga orchestration~~
1. ~~Save detailed file history~~
1. ~~Nested Archives~~
1. ~~Nested Rar test failing~~
1. ~~Configuration from file~~
1. ~~String paths https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string~~
1. ~~Better content cleanup~~
1. ~~Suggest naming~~
1. ~~Number padding~~
1. ~~Ignore case of junk to filter~~
1. ~~Prefer series name from series if native~~
1. ~~Deeply nested folders with globbing~~

1. ~~Write ComicInfo.xml~~
1. ~~Remove junk from Image folders, names, content~~
1. ~~Clean CBZs~~
1. ~~Handle Volume ranges~~

1. ~~If TotalVolumes matches folder count, extract to individual~~
1. ~~Nested image folders that are multivolume~~
1. ~~fix halfwidth fullwidth chars for file folder pattern~~
1. ~~Get metadata from archive contents~~
1. ~~Convert Image folders to CBZ~~
1. ~~Fix deletion after extracting folders - doesn't delete the clean dir~~
1. ~~Vendor Series metadata~~
1. ~~Automate maintenance~~
1. ~~Unified Series calls data vendors once per series~~

1. ~~Cleanup regression~~
1. ~~invalid images still being zipped~~
1. ~~Stopped on moving series~~
1. ~~Stat error not killing it on 7z -t~~
1. ~~Start importing clean series~~
1. ~~null in summary/description~~
1. ~~Offline options~~

1. ~~volume range with archives takes second as a batch, but then deletes the first, and leaves the rest as dupes~~
1. ~~Archive with multiple folder volumes failed: Brave Story, not cleaned up but made. Ran on individual volumes, and each was a separate series~~
1. ~~didn't clean up soil 9 & 10~~
1. ~~Shuto Heru v13-14~~
1. ~~keep the range if it wasn't split~~
1. ~~Handle hakuneko folders~~

1. ~~Add magazines~~
1. ~~Download book covers~~
1. ~~Trim white space~~
1. ~~Split Double Images~~
1. ~~Waifu2x~~

1. Add tags
1. Get names from google organic search
1. Undo naming / folder move
1. Master Config Test. > x results
1. Manual Series metadata
1. Scraper Series metadata
1. Get a new cover image based on existing dimension / reverse image lookup
1. Detect missing volumes/issues
1. Interactive naming
1. Webp
1. Record File hash drift events
1. Send API request to Komga
