*** Settings ***
Documentation     Agent Interceptor: checks that the org holds the outcome an agent conversation
...               was supposed to produce. Generic and data-driven: the checks arrive per run as
...               base64-encoded JSON in CHECKS_B64 (a list of {key, object, id, field, expected}).
...               Logs one machine-readable "IVERIFY|<json>" line per check, then fails if any
...               check failed. SF_CLIENT_ID / SF_CLIENT_SECRET are sensitive CRT variables.
Library           QForce

*** Variables ***
${SF_DOMAIN}      not-passed
${CHECKS_B64}     not-passed
${RUN_ID}         not-passed

*** Test Cases ***
Org Holds Expected Outcome
    Should Not Be Equal    ${CHECKS_B64}    not-passed    msg=CHECKS_B64 was not passed with --variable
    Log To Console    IRUN|${RUN_ID}
    Client Authenticate    ${SF_DOMAIN}    ${SF_CLIENT_ID}    ${SF_CLIENT_SECRET}
    ${checks}=    Evaluate    json.loads(base64.b64decode($CHECKS_B64).decode('utf-8'))    modules=json,base64
    ${failed}=    Set Variable    ${0}
    FOR    ${check}    IN    @{checks}
        ${pass}=    Check Field    ${check}
        ${failed}=    Evaluate    $failed + (0 if $pass else 1)
    END
    Should Be Equal As Integers    ${failed}    0    msg=${failed} check(s) did not match the expected org state

*** Keywords ***
Check Field
    [Arguments]    ${check}
    ${result}=    Query Records    SELECT Id, ${check}[field] FROM ${check}[object] WHERE Id = '${check}[id]'
    ${records}=    Set Variable    ${result}[records]
    ${found}=    Evaluate    len($records) == 1
    ${actual}=    Evaluate    $records[0].get($check['field']) if $found else None
    ${expected}=    Set Variable    ${check}[expected]
    # Same rules as valuesMatch() in Agent Interceptor: empty matches empty, numbers compare
    # numerically, booleans ignore case, strings must be identical.
    ${empty_ok}=    Evaluate    ($expected is None or $expected == '') and ($actual is None or $actual == '')
    ${value_ok}=    Evaluate    $actual is not None and $expected is not None and $expected != '' and ((str($actual).lower() == str($expected).lower()) if isinstance($actual, bool) else (str($actual) == str($expected) or (isinstance($actual, (int, float)) and isinstance($expected, (int, float)) and float($actual) == float($expected))))
    ${pass}=    Evaluate    bool($found and ($empty_ok or $value_ok))
    ${line}=    Evaluate    json.dumps({'key': $check['key'], 'found': $found, 'actual': $actual, 'pass': $pass})    modules=json
    Log To Console    IVERIFY|${line}
    RETURN    ${pass}
