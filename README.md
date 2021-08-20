# ComicEater: comic-utils
A collection of utilities for comic book archive management

## Install
`sudo apt-get install p7zip imagemagick`

## Convert to CBZ (from Rar, Rar5, Zip, CBR, 7z)
### Template
`yarn main "<archiveDir>" --convertToCBZ`
### Example
`yarn main "W:\Comics\1 優先\6 キュー\優先\極東事変 第1巻.zip" --convertToCBZ"`
### Option
`--convertToCBZ`
#### Flow
1. ☑ Get all archives at path
1. ☐ Get all image folders in path
1. ☑ Don't extract if targetted CBZ of the archives already exists
1. ☑ Test that the archives are valid archives with `7z t`
1. ☑ Extract archive in current directory
1. ☐ Recursively check for nested archives, and apply each of the following steps to each archive.
1. ☐ Validate that there are images present in extracted archives
1. ☑ Validate that images are valid using ImageMagick by doing a transform to a 5x5 image - Currently requires writing them to a `/tmp/` directory that is automatically cleaned up after the test is run
1. ☐ Remove archive distributer bloat per user config (links to tracker etc.)
1. ☐ If `--convertToWebp`, convert all images to webp format (Investigate is this can replace the validation step, and avoid writing to `/tmp` twice)
1. ☑ Repack images
1. ☐ If nested archives exist, flatten all nested archives in place of the original
1. ☑ If there were no errors, remove the extracted working directory
1. ☐ Update `ComicEater.json` with available metadata (history) in the archive


## Convert to Series
## Description
Move CBZ's to Series folders and update their metadata.
### Template
`yarn main "<archiveDir>" --converToSeries --seriesFolder "<rootSeriesFolder>"`
### Example
`yarn main "W:\Comics\1 優先\6 キュー\優先\極東事変" --convertToSeries --seriesFolder "W:\Comics\1 優先\6 キュー\優先"`
### Option
`--seriesFolder`
#### Flow
1. ☑ Get all archives at path
1. ☐ Get any meta data available from the `ComicEater.json` file
1. ☑ Infer each root level archives series from file if no existing metadata
1. ☐ Get metadata using existing data from remote sources
1. ☑ Put archives in their root series folder according to `--seriesFolder`
1. ☑ Name the series according to the available metadata
1. ☐ Rename the archive according to the metadata and configuration rules
1. ☐ Update `ComicEater.json` and `ComicInfo.xml` with available metadata in the archive

## Set Metadata

### TODO
1. File names w/ spaces breaks spawn
1. Save detailed file history
1. Nested archives
1. Better content cleanup
1. Convert Image folders to CBZ
1. Write ComicInfo.xml
1. Automatic Series metadata
1. Manual Series metadata
1. Scraper Series metadata
1. Webp
1. Record File hash drift events
