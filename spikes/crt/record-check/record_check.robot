*** Settings ***
Documentation     Phase 0 check 4: authenticate to the demo org with the client credentials flow
...               and assert one field on one test record. Values come in with --variable.
...               SF_CLIENT_ID and SF_CLIENT_SECRET are sensitive CRT variables on robot 28176.
Library           QForce

*** Variables ***
${SF_DOMAIN}            not-passed
${RECORD_ID}            not-passed
${EXPECTED_DESCRIPTION}    not-passed

*** Test Cases ***
Credential Shape Looks Right
    [Documentation]    Logs only lengths and the shared 3MVG prefix check, never the values.
    ${id_len}=    Get Length    ${SF_CLIENT_ID}
    ${secret_len}=    Get Length    ${SF_CLIENT_SECRET}
    ${id_prefix_ok}=    Evaluate    $SF_CLIENT_ID.startswith('3MVG')
    ${id_has_space}=    Evaluate    any(c.isspace() for c in $SF_CLIENT_ID)
    Log To Console    SHAPE|id_len=${id_len}|id_starts_3MVG=${id_prefix_ok}|id_has_whitespace=${id_has_space}|secret_len=${secret_len}

Record Field Matches Expected Value
    Should Not Be Equal    ${RECORD_ID}    not-passed
    Client Authenticate    ${SF_DOMAIN}    ${SF_CLIENT_ID}    ${SF_CLIENT_SECRET}
    ${result}=    Query Records    SELECT Id, Name, Description FROM Account WHERE Id = '${RECORD_ID}'
    Log To Console    QUERY|${result}
    ${records}=    Set Variable    ${result}[records]
    Length Should Be    ${records}    1
    ${actual}=    Set Variable    ${records}[0][Description]
    Log To Console    ACTUAL|${actual}|EXPECTED|${EXPECTED_DESCRIPTION}
    Should Be Equal As Strings    ${actual}    ${EXPECTED_DESCRIPTION}
