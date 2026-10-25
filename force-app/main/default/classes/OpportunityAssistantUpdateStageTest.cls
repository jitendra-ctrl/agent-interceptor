@IsTest
private class OpportunityAssistantUpdateStageTest {
    @TestSetup
    static void makeData() {
        insert new Opportunity(Name = 'AI-Unit Update', StageName = 'Prospecting', CloseDate = Date.today().addDays(30));
    }

    @IsTest
    static void changesStageAndReportsSuccess() {
        Id oppId = oppId();
        OpportunityAssistantUpdateStage.Result r = updateStage(oppId, 'Qualification');
        Assert.isTrue(r.success, r.message);
        Assert.areEqual('Prospecting', r.previousStage);
        Assert.areEqual('Qualification', r.currentStage);
        Assert.areEqual('Stage changed from Prospecting to Qualification.', r.message);
        Assert.areEqual('Qualification', [SELECT StageName FROM Opportunity WHERE Id = :oppId].StageName);
    }

    @IsTest
    static void stageMatchingIsCaseInsensitive() {
        Id oppId = oppId();
        OpportunityAssistantUpdateStage.Result r = updateStage(oppId, '  closed won ');
        Assert.isTrue(r.success, r.message);
        Assert.areEqual('Closed Won', r.currentStage);
    }

    @IsTest
    static void invalidStageIsRejectedWithoutSaving() {
        Id oppId = oppId();
        OpportunityAssistantUpdateStage.Result r = updateStage(oppId, 'Signed');
        Assert.isFalse(r.success);
        Assert.areEqual('Prospecting', r.currentStage);
        Assert.isTrue(r.message.startsWith('Stage "Signed" isn\'t valid. Valid stages: '), r.message);
        Assert.isTrue(r.message.contains('Closed Won'), r.message);
        Assert.areEqual('Prospecting', [SELECT StageName FROM Opportunity WHERE Id = :oppId].StageName);
    }

    @IsTest
    static void blankStageIsRejected() {
        OpportunityAssistantUpdateStage.Result r = updateStage(oppId(), '');
        Assert.isFalse(r.success);
    }

    @IsTest
    static void sameStageIsReportedWithoutSaving() {
        Integer dmlBefore = Limits.getDmlStatements();
        OpportunityAssistantUpdateStage.Result r = updateStage(oppId(), 'Prospecting');
        Assert.isTrue(r.success);
        Assert.areEqual(dmlBefore, Limits.getDmlStatements(), 'no DML when nothing changes');
        Assert.isTrue(r.message.startsWith('The opportunity is already in stage Prospecting'), r.message);
    }

    @IsTest
    static void unknownOrMalformedIdIsNotFound() {
        Id deletedId = oppId();
        delete new Opportunity(Id = deletedId);
        Assert.areEqual('Opportunity not found or not accessible.', updateStage(deletedId, 'Qualification').message);
        Assert.isFalse(updateStage('not-an-id', 'Qualification').success);
        Assert.isFalse(updateStage(UserInfo.getUserId(), 'Qualification').success, 'non-Opportunity id');
        Assert.isFalse(updateStage(null, 'Qualification').success);
    }

    // Real save failure: a Read Only user can see the opportunity but cannot edit it.
    // The action must report success = false with the platform's error text.
    @IsTest
    static void saveErrorIsReportedAsFailure() {
        User readOnly = readOnlyUser();
        Opportunity opp = [SELECT Id FROM Opportunity LIMIT 1];
        opp.OwnerId = readOnly.Id;
        update opp;

        OpportunityAssistantUpdateStage.Result r;
        System.runAs(readOnly) {
            r = updateStage(opp.Id, 'Qualification');
        }
        Assert.isFalse(r.success, r.message);
        Assert.isTrue(r.message.startsWith('The change was not saved: '), r.message);
        Assert.areEqual('Prospecting', r.currentStage);
        Assert.areEqual('Prospecting', [SELECT StageName FROM Opportunity WHERE Id = :opp.Id].StageName);
    }

    @IsTest
    static void bulkRequestsUseOneSave() {
        List<Opportunity> extra = new List<Opportunity>{
            new Opportunity(Name = 'AI-Unit Bulk 1', StageName = 'Prospecting', CloseDate = Date.today()),
            new Opportunity(Name = 'AI-Unit Bulk 2', StageName = 'Prospecting', CloseDate = Date.today())
        };
        insert extra;
        List<OpportunityAssistantUpdateStage.Request> reqs = new List<OpportunityAssistantUpdateStage.Request>{
            request(extra[0].Id, 'Qualification'),
            request(extra[1].Id, 'Signed'),
            request(oppId(), 'Closed Lost')
        };
        Integer dmlBefore = Limits.getDmlStatements();
        List<OpportunityAssistantUpdateStage.Result> results = OpportunityAssistantUpdateStage.execute(reqs);
        Assert.areEqual(1, Limits.getDmlStatements() - dmlBefore, 'one save for all requests');
        Assert.isTrue(results[0].success);
        Assert.isFalse(results[1].success);
        Assert.isTrue(results[2].success);
        Assert.areEqual('Closed Lost', results[2].currentStage);
    }

    private static Id oppId() {
        return [SELECT Id FROM Opportunity WHERE Name = 'AI-Unit Update' LIMIT 1].Id;
    }

    private static OpportunityAssistantUpdateStage.Result updateStage(String oppId, String stage) {
        return OpportunityAssistantUpdateStage.execute(
            new List<OpportunityAssistantUpdateStage.Request>{ request(oppId, stage) }
        )[0];
    }

    private static OpportunityAssistantUpdateStage.Request request(String oppId, String stage) {
        OpportunityAssistantUpdateStage.Request req = new OpportunityAssistantUpdateStage.Request();
        req.opportunityId = oppId;
        req.newStage = stage;
        return req;
    }

    private static User readOnlyUser() {
        Profile p = [SELECT Id FROM Profile WHERE Name = 'Read Only' LIMIT 1];
        String unique = 'ai-unit-' + Crypto.getRandomInteger() + '@example.com';
        User u = new User(
            Alias = 'aiunit',
            Email = unique,
            EmailEncodingKey = 'UTF-8',
            LastName = 'AI Unit Read Only',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = p.Id,
            TimeZoneSidKey = 'America/Los_Angeles',
            UserName = unique
        );
        // runAs keeps the setup-object insert separate from the Opportunity DML (no MIXED_DML_OPERATION).
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert u;
        }
        return u;
    }
}
