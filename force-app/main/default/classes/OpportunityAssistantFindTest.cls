@IsTest
private class OpportunityAssistantFindTest {
    @TestSetup
    static void makeData() {
        List<Opportunity> opps = new List<Opportunity>{
            newOpp('AI-Unit Alpha', 'Prospecting', 1000),
            newOpp('AI-Unit Beta One', 'Qualification', null),
            newOpp('AI-Unit Beta Two', 'Needs Analysis', 2000),
            newOpp('AI-Unit Exact', 'Prospecting', 10),
            newOpp('AI-Unit Exact Plus', 'Prospecting', 20)
        };
        for (Integer i = 1; i <= 7; i++) {
            opps.add(newOpp('AI-Unit Many ' + i, 'Prospecting', i));
        }
        insert opps;
    }

    @IsTest
    static void singlePartialMatchReturnsRecord() {
        OpportunityAssistantFind.Result r = find('alpha');
        Assert.areEqual(1, r.matchCount);
        Assert.areEqual([SELECT Id FROM Opportunity WHERE Name = 'AI-Unit Alpha'].Id, r.opportunityId);
        Assert.areEqual('AI-Unit Alpha', r.opportunityName);
        Assert.areEqual('Prospecting', r.stageName);
        Assert.areEqual(Date.today().addDays(30), r.closeDate);
        Assert.areEqual(1000, r.amount);
        Assert.areEqual('', r.candidates);
    }

    @IsTest
    static void exactMatchWinsOverPartialMatches() {
        // "AI-Unit Exact" also appears inside "AI-Unit Exact Plus".
        OpportunityAssistantFind.Result r = find('ai-unit exact');
        Assert.areEqual(1, r.matchCount);
        Assert.areEqual('AI-Unit Exact', r.opportunityName);
    }

    @IsTest
    static void severalMatchesReturnCandidatesAndNoId() {
        OpportunityAssistantFind.Result r = find('Beta');
        Assert.areEqual(2, r.matchCount);
        Assert.areEqual('', r.opportunityId);
        Assert.isNull(r.stageName);
        Assert.isTrue(r.candidates.contains('AI-Unit Beta One (Qualification, close '), r.candidates);
        Assert.isTrue(r.candidates.contains('AI-Unit Beta Two (Needs Analysis, close '), r.candidates);
    }

    @IsTest
    static void moreThanFiveMatchesAreCappedInCandidates() {
        OpportunityAssistantFind.Result r = find('Many');
        Assert.areEqual(7, r.matchCount);
        List<String> lines = r.candidates.split('\n');
        Assert.areEqual(OpportunityAssistantFind.MAX_CANDIDATES + 1, lines.size());
        Assert.areEqual('and 2 more', lines[lines.size() - 1]);
    }

    @IsTest
    static void noMatchReturnsZero() {
        OpportunityAssistantFind.Result r = find('does-not-exist');
        Assert.areEqual(0, r.matchCount);
        Assert.areEqual('', r.opportunityId);
        Assert.isTrue(r.message.startsWith('No opportunity matching'), r.message);
    }

    @IsTest
    static void blankNameAsksForName() {
        OpportunityAssistantFind.Result r = find('   ');
        Assert.areEqual(0, r.matchCount);
        Assert.areEqual('Please provide an opportunity name.', r.message);
    }

    @IsTest
    static void likeWildcardsAreLiteral() {
        Assert.areEqual(0, find('%').matchCount);
        Assert.areEqual(0, find('AI_Unit').matchCount);
        Assert.areEqual('a\\%b\\_c\\\\', OpportunityAssistantFind.escapeLike('a%b_c\\'));
    }

    @IsTest
    static void bulkRequestsAreAnsweredInOrder() {
        List<OpportunityAssistantFind.Request> reqs = new List<OpportunityAssistantFind.Request>{
            request('Alpha'), request('Beta'), request('nothing')
        };
        Integer queriesBefore = Limits.getQueries();
        List<OpportunityAssistantFind.Result> results = OpportunityAssistantFind.execute(reqs);
        Assert.areEqual(1, Limits.getQueries() - queriesBefore, 'one query for all requests');
        Assert.areEqual(3, results.size());
        Assert.areEqual(1, results[0].matchCount);
        Assert.areEqual(2, results[1].matchCount);
        Assert.areEqual(0, results[2].matchCount);
    }

    private static OpportunityAssistantFind.Result find(String name) {
        return OpportunityAssistantFind.execute(new List<OpportunityAssistantFind.Request>{ request(name) })[0];
    }

    private static OpportunityAssistantFind.Request request(String name) {
        OpportunityAssistantFind.Request req = new OpportunityAssistantFind.Request();
        req.opportunityName = name;
        return req;
    }

    private static Opportunity newOpp(String name, String stage, Decimal amount) {
        return new Opportunity(Name = name, StageName = stage, CloseDate = Date.today().addDays(30), Amount = amount);
    }
}
