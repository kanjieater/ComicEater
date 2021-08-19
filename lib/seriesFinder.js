const { log } = require('./logger');

const config = {
  junkToFilter: ['DLraw\.net\-'],
  issueNumberFilters: ['v([0-9]*)', '第([0-9]*)', '- 第([0-9]*)','([0-9]*)'],
};

function removeVol() {

}

function getVol() {

}

function removeJunk(input, junkToFilter) {
  let cleanedInput = input;
  junkToFilter.forEach(regex => {
    cleanedInput = input.replace(new RegExp(regex, 'g'), '');
  });
  return cleanedInput.trim();
}



function extractIssueNumber(input, issueNumberFilters) {
  let cleanedInput = input;
  let hasIssueNumber = false;
  let issueNumber = null;
  let removedIssueInput = cleanedInput;  
  issueNumberFilters.forEach(regex => {
    const r = new RegExp(regex, 'g')
    cleanedInput = cleanedInput.replace(r, '').trim();
    
    
    const matches = input.matchAll(r);
    for (const match of matches) {
      if (match.length == 2){
        log(removedIssueInput + ' before');
        removedIssueInput = removedIssueInput.slice(0, removedIssueInput.indexOf(match[0])).trim()
        log(removedIssueInput);
        issueNumber = Number(match[1])
        log(`Found issue number ${issueNumber}`);
        hasIssueNumber = true;
        break;
      }
    }
  });
  return {issueNumber, updatedInput: removedIssueInput, hasIssueNumber};
}

function find(input) {
  const cleanedInput = removeJunk(input, config.junkToFilter);
  const {issueNumber, updatedInput, hasIssueNumber} = extractIssueNumber(cleanedInput, config.issueNumberFilters);

  return {series: updatedInput, issueNumber, hasIssueNumber};
}

module.exports = {
  find,
};
