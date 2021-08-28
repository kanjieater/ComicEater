# ComicEater: comic-utils
A collection of utilities for comic book archive management

## Install
`sudo apt-get install p7zip imagemagick unrar`

## Convert to CBZ (from Rar, Rar5, Zip, CBR, 7z)
### Template
`yarn main --archiveDir "<archiveFile or archiveFolder>" --convertToCBZ`
### Example
`yarn main "W:\Comics\1 優先\6 キュー\優先\極東事変 第1巻.zip" --convertToCBZ"`
### Option
`--convertToCBZ`
#### Flow
1. ☑ Get all archives at path
1. ☐ Get all image folders in path
1. ☑ Don't extract if targeted CBZ of the archives already exists
1. ☑ Test that the archives are valid archives with `7z t`
1. ☑ Extract archive in current directory
1. ☑ Recursively check for nested archives, and apply each of the following steps to each archive.
1. ☐ Validate that there are images present in extracted archives
1. ☑ Validate that images are valid using ImageMagick by doing a transform to a 5x5 image - Currently requires writing them to a `/tmp/` directory that is automatically cleaned up after the test is run
1. ☐ Remove archive distributer bloat per user config (links to tracker etc.)
1. ☐ If `--convertToWebp`, convert all images to webp format (Investigate if this can replace the image validation step, and avoid writing to `/tmp` twice)
1. ☑ Repack images
1. ☑ If nested archives exist, flatten all nested archives in place of the original
1. ☑ If there were no errors, remove the extracted working directory
1. ☑ Update `ComicEater.json` with available metadata (history) in the archive


## Convert to Series
## Description
Move CBZ's to Series folders and update their metadata. Your archives must already be valid CBZs.
### Option
`--seriesFolder`

`--archivePath`

`--convertToSeries`
### Template
#### Single File TODO re-enable
`yarn main --archivePath "<archiveFile or archiveFolder>" --convertToSeries --seriesFolder "<rootSeriesFolder>"`

#### Optional
`--seriesFolder "<rootSeriesFolder>"`
Overrides the config file's first rootSeriesFolders. Only will put content into this folder.
### Example

`--convertToSeries` Options

Move the archive(s) at the path to the series folder based on their name. Infers series name from the archive name if it's in the base folder.

`yarn main --archivePath "W:\Comics\1 優先\6 キュー\優先\極東事変" --convertToSeries --seriesFolder "W:\Comics\1 優先\6 キュー\優先"`

#### Flow
1. ☑ Get all archives at path
1. ☐ Get any meta data available from the `ComicEater.json` file
1. ☑ Infer each seriesRoot level archives series from file if no existing metadata
1. ☐ Get metadata from remote sources
1. ☑ Put archives in their seriesRoot series folder according to `--seriesFolder`
1. ☑ Name the series according to the available metadata
1. ☐ Rename the archive according to the metadata and configuration rules
1. ☐ Update `ComicEater.json` and `ComicInfo.xml` with available metadata in the archive

#### Maintain Collection
## Description
This is meant to be run as a service and will rerun based on `scanCron` in seconds.
It convert archives from the `seriesFolders`'s `queueFolders` to CBZ's. Then converts them to series and updates their metadata.
### Option
`--configFile`
`--maintainCollection`
### Template
`yarn main --configFile "<configFile>" --maintainCollection`
### Example
`yarn main --configFile "W:\Collection\ComicEater.test.yml" --maintainCollection -vvv`


#### Flow
1. ☑ Get all archives at `queueFolders`
1. ☐ Convert them to CBZ
1. ☐ Use `folderPatterns` to gather meta data from the folder about the files
1. ☐ Use the `filePatterns` to gather data about the files
1. ☐ Search remote sources for any additional meta data
1. ☐ Rename the archive according to the metadata and `comic.json`'s `outputNamingConventions`
1. ☐ Update `ComicEater.json` and `ComicInfo.xml` with available metadata in the archive



## Set Metadata
## Description
Inside the app there are 3 ways of thinking about meta data.
1. Meta data about the archive itself (History)
1. Meta data about the content (Series, Volume, etc.)
1. Meta data about the pipelines progress (Context: Internal runtime info of the pipelines "saga" work)
Only the Archive Meta Data & Content Meta Data get persisted to the archive. Though pieces of the Context Meta Data may be embedded inside of History in order to allow for "rollbacks".

### TODO
1. ~~File names w/ spaces breaks spawn~~
1. ~~Saga orchestration~~
1. ~~Save detailed file history~~
1. ~~Nested Archives~~
1. ~~Nested Rar test failing~~
1. ~~Configuration from file~~
1. ~~String paths https://stackoverflow.com/questions/29182244/convert-a-string-to-a-template-string~~
1. ~~Better content cleanup~~
1. ~~Suggest naming~~
1. Write ComicInfo.xml
1. Automatic Series metadata
1. Manual Series metadata
1. Automate maintenance
1. Convert Image folders to CBZ
1. Scraper Series metadata
1. Get a new cover image
1. Get a new cover image based on existing dimension / reverse image lookup
1. Webp
1. Record File hash drift events
1. Detect missing volumes/issues
