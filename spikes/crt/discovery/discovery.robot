*** Settings ***
Documentation     Phase 0 discovery: list QForce keywords and signatures, check which Python
...               modules are importable, and prove that a value passed with --variable arrives.
...               Does not open a browser or contact Salesforce.
Library           QForce

*** Variables ***
${RUN_ID}         not-passed

*** Test Cases ***
Passed Variable Arrives
    Log To Console    RUN_ID=${RUN_ID}
    Should Not Be Equal    ${RUN_ID}    not-passed

List QForce Keywords
    ${kws}=    Evaluate    __import__('robot.libdocpkg', fromlist=['LibraryDocumentation']).LibraryDocumentation('QForce').keywords
    FOR    ${kw}    IN    @{kws}
        Log To Console    KW|${kw.name}|${kw.args}|${kw.short_doc}
    END

Check Python Modules
    FOR    ${mod}    IN    requests    simple_salesforce    jwt    cryptography    QWeb    RequestsLibrary
        ${found}=    Evaluate    __import__('importlib.util', fromlist=['find_spec']).find_spec('${mod}') is not None
        Log To Console    MOD|${mod}|${found}
    END
