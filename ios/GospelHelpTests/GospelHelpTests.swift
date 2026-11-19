import Foundation
import Testing
@testable import GospelHelp

private func passage(
    source: Source = .bible, reference: String = "Hebrews 11:1", text: String = "Now faith is the substance.",
    title: String? = nil, url: String = "https://www.churchofjesuschrist.org/study/scriptures/nt/heb/11?id=p1#p1",
    id: String? = "bible:Hebrews 11:1", metadata: [String: JSONValue] = [:]
) -> Passage {
    Passage(apiID: id, source: source, reference: reference, text: text, title: title, url: url, score: 0.9, metadata: metadata)
}

@Suite struct BookmarkKeyTests {
    // Values computed with the web app's bookmarks.ts hash in Node.
    @Test func hashMatchesWeb() {
        #expect(Passage.djb2("Now faith is the substance of things hoped for, the evidence of things not seen.") == "36gdj9")
        #expect(Passage.djb2("“Faith” — é 😀") == "hmhyd2")
        #expect(Passage.djb2("") == "45h")
    }

    @Test @MainActor func savedMatchesByLegacyKey() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let store = BookmarkStore(fileURL: dir.appending(path: "b.json"))
        let old = passage(id: nil)
        store.toggle(old)
        // The same passage, now carrying an API id, is recognised as saved.
        #expect(store.isSaved(passage()))
        #expect(store.importPassages([passage()]) == 0)
        // And toggling it removes the old entry.
        #expect(store.toggle(passage()) == false)
        #expect(store.count == 0)
        // Persisted across instances.
        store.toggle(passage())
        #expect(BookmarkStore(fileURL: dir.appending(path: "b.json")).count == 1)
    }
}

@Suite struct ShareCodecTests {
    // A token the web app's encoder produced (CompressionStream "deflate-raw").
    let webToken = "v1.Vc6xasMwEAbgVxF_V2Oh9SB0DSl07FI6WLIcXUkloTuhFuN3Dxk65HuCb0cFfe4QEDz7W8SEBsI5-haHGOfIYcIvCO9lmG1hTYbFaIpGuhddcoimbEYT56uYVGpczVbajAkdhKRahawdY8wh9RZS2b6jdAmpsehc2tWK9vXPSmhctbcoNqtN0VvnXnk9VfdSH4cf0A5tS5bbolwyCG-XDxwT-D9PT-3j67gD"

    @Test func decodesWebCollection() throws {
        let decoded = try ShareCodec.decodeCollection(webToken)
        #expect(decoded.passages.count == 1)
        #expect(decoded.passages[0].apiID == "bible:Hebrews 11:1")
        #expect(decoded.passages[0].meta("translation") == "KJV")
        #expect(decoded.skipped == 0)
    }

    @Test func collectionRoundTrips() throws {
        let talk = passage(
            source: .conference, reference: "Fourth Floor, Last Door", text: "Faith is a strong conviction.",
            title: "Fourth Floor, Last Door",
            url: "https://www.churchofjesuschrist.org/study/general-conference/2016/10/fourth-floor-last-door?lang=eng#p9",
            id: "conference:/general-conference/2016/10/fourth-floor-last-door:p9",
            metadata: ["speaker": .string("Dieter F. Uchtdorf"), "year": .number(2016), "month": .string("10"), "talk_uri": .string("/x")])
        let url = try ShareCodec.collectionURL([passage(), talk])
        guard case .collection(let token) = ShareCodec.parse(url) else { Issue.record("no token"); return }
        let decoded = try ShareCodec.decodeCollection(token)
        #expect(decoded.passages.map(\.id) == [passage().id, talk.id])
        #expect(decoded.passages[1].dateLabel == "October 2016")
        // Only display metadata travels.
        #expect(decoded.passages[1].metadata["talk_uri"] == nil)
    }

    @Test func rejectsForeignLinks() throws {
        let evil = passage(url: "https://evil.example/phish")
        #expect(ShareCodec.fromWire(ShareCodec.toWire(evil)) == nil)
        #expect(ShareCodec.isAllowedSourceURL("https://speeches.byu.edu/talks/x/"))
        #expect(!ShareCodec.isAllowedSourceURL("https://user:pw@www.churchofjesuschrist.org/"))
        #expect(!ShareCodec.isAllowedSourceURL("javascript:alert(1)"))
        #expect(throws: ShareError.self) { try ShareCodec.decodeCollection("v2.abc") }
        #expect(throws: ShareError.self) { try ShareCodec.decodeCollection("v1.!!!") }
    }

    @Test func answerRoundTrips() throws {
        let answer = ShareCodec.Answer(
            question: "What is faith?",
            segments: [AskSegment(text: "Faith is hope in what is true.", cites: [1]), AskSegment(text: " More.", cites: [])],
            citations: [1: passage()])
        let url = try ShareCodec.answerURL(answer)
        #expect(url.absoluteString.hasPrefix("https://gospel.help/#ask=v1."))
        guard case .answer(let token) = ShareCodec.parse(url) else { Issue.record("no token"); return }
        let decoded = try ShareCodec.decodeAnswer(token)
        #expect(decoded.question == answer.question)
        #expect(decoded.segments == answer.segments)
        #expect(decoded.citations[1]?.id == passage().id)
        #expect(ShareCodec.answerText(decoded).contains("Faith is hope in what is true.[1]"))
    }

    @Test func parsesIncomingLinks() {
        #expect(ShareCodec.parse(URL(string: "gospelhelp://open?q=charity%20never%20faileth")!) == .search("charity never faileth"))
        #expect(ShareCodec.parse(URL(string: "https://gospel.help/")!) == nil)
    }
}

@Suite struct AskParserTests {
    @Test func foldsEventsIntoSegments() throws {
        var parser = AskEventParser()
        let passageJSON = #"{"id":"bible:John 3:16","source":"bible","reference":"John 3:16","text":"For God so loved the world","title":null,"url":"https://www.churchofjesuschrist.org/study/scriptures/nt/john/3?id=p16#p16","score":0.9,"metadata":{"verse":16}}"#
        let lines = [
            "event: meta", #"data: {"hour_left": 9, "day_left": 29}"#,
            "event: search", #"data: {"query": "God's love"}"#,
            "event: text", #"data: {"text": "God loves the world"}"#,
            "event: cite", #"data: {"n": 1, "passage": \#(passageJSON)}"#,
            "event: block", "data: {}",
            "event: text", #"data: {"text": " and each of us."}"#,
            "event: done", "data: {}",
        ]
        var events: [AskEvent] = []
        for line in lines { events += try parser.consume(line: line) }
        #expect(parser.finished)
        #expect(parser.segments == [
            AskSegment(text: "God loves the world", cites: [1]),
            AskSegment(text: " and each of us.", cites: []),
        ])
        let cited = events.compactMap { if case .citation(let n, let p) = $0 { (n, p) } else { nil } }
        #expect(cited.first?.0 == 1)
        #expect(cited.first?.1.reference == "John 3:16")
    }

    @Test func resetDropsDraft() throws {
        var parser = AskEventParser()
        _ = try parser.consume(line: "event: text")
        _ = try parser.consume(line: #"data: {"text": "draft"}"#)
        _ = try parser.consume(line: "event: reset")
        _ = try parser.consume(line: "data: {}")
        #expect(parser.segments.isEmpty)
    }

    @Test func errorEventThrows() {
        var parser = AskEventParser()
        _ = try? parser.consume(line: "event: error")
        #expect(throws: AskError.self) { try parser.consume(line: #"data: {"message": "Cut off"}"#) }
    }

    @Test func circledNumbers() {
        #expect(AnswerText.circled(1) == "❶")
        #expect(AnswerText.circled(11) == "⓫")
        #expect(AnswerText.circled(21) == "㉑")
        #expect(AnswerText.circled(50) == "㊿")
        #expect(AnswerText.circled(51) == "[51]")
    }
}

@Suite struct DisplayTests {
    @Test func headingsAndMeta() {
        let byu = passage(source: .byuSpeeches, reference: "The Power of Your Words", title: "The Power of Your Words",
                          metadata: ["speaker": .string("Craig Manning"), "date": .string("January 31, 2017"), "year": .number(2017)])
        #expect(byu.heading == "The Power of Your Words")
        #expect(byu.metaLine == "Craig Manning · January 31, 2017")
        let handbook = passage(source: .handbook, reference: "1.2", title: "Chapter",
                               metadata: ["section_title": .string("Purpose"), "chapter": .string("1"), "section_number": .string("1.2")])
        #expect(handbook.heading == "Purpose")
        #expect(handbook.metaLine == "1 · 1.2")
    }

    @Test func sortsNewestFirstKeepingUndatedLast() {
        let old = passage(source: .conference, reference: "Old", id: "a", metadata: ["year": .number(1980), "month": .string("04")])
        let new = passage(source: .byuSpeeches, reference: "New", id: "b", metadata: ["date": .string("May 6, 2008")])
        let verse = passage(id: "c")
        #expect(sortPassages([verse, old, new], by: .date).map(\.id) == ["b", "a", "c"])
        #expect(sortPassages([verse, old, new], by: .relevance).map(\.id) == ["c", "a", "b"])
    }

    @Test func markdownExport() {
        let md = MarkdownExport.passage(passage(text: "# Not a heading\n\n1. not a list"))
        #expect(md.contains("> \\# Not a heading"))
        #expect(md.contains("> \\1. not a list"))
        #expect(md.contains("[churchofjesuschrist.org]("))
    }

    @Test func searchURLEncodesQuery() {
        let url = APIClient.searchURL(.init(queryType: .natural, query: "faith + works", count: 20, sources: [.bible, .conference], filters: .init(speaker: "Dallin H. Oaks", yearFrom: 2010, yearTo: nil)))
        let s = url.absoluteString
        #expect(s.contains("/search?query=faith%20%2B%20works&k=20&sources=bible,conference&speaker=Dallin%20H.%20Oaks&year_from=2010"))
    }

    @Test func speakerFolding() {
        #expect(SpeakerStore.fold("Gérald Caussé") == "gerald causse")
    }
}

@Suite struct HostileLinkTests {
    private func token(_ object: Any) throws -> String { try ShareCodec.pack(object) }

    private let base: [String: Any] = [
        "s": "conference", "r": "A Talk", "x": "Some text.",
        "u": "https://www.churchofjesuschrist.org/study/general-conference/2016/10/x",
    ]

    @Test func hugeNumbersDontCrash() throws {
        var entry = base
        entry["m"] = ["year": 1e300, "speaker": 1e20, "month": 1e300]
        let decoded = try ShareCodec.decodeCollection(try token(["p": [entry]]))
        let p = decoded.passages[0]
        #expect(p.metadata["year"] == nil)
        // Reading and re-sharing the display fields must not trap.
        _ = p.dateLabel
        _ = p.metaLine
        _ = try ShareCodec.collectionURL([p])
        #expect(JSONValue.number(1e300).int == nil)
        #expect(JSONValue.number(1e300).string == String(1e300))
    }

    @Test func rejectsEmptyReferenceAndOddCitations() throws {
        var empty = base
        empty["r"] = ""
        #expect(throws: ShareError.self) { try ShareCodec.decodeCollection(try token(["p": [empty]])) }

        var cited = base
        cited["n"] = 1
        let answer = try ShareCodec.decodeAnswer(try token([
            "q": "Q?", "a": [["Text.", [true, 1.5, 1]]], "p": [cited],
        ]))
        #expect(answer.segments[0].cites == [1])
    }

    @Test @MainActor func excerptsAreNeverSaved() throws {
        var cut = base
        cut["n"] = 1
        cut["k"] = 1
        cut["i"] = "conference:/x:p1"
        let answer = try ShareCodec.decodeAnswer(try token(["q": "Q?", "a": [["Text.", [1]]], "p": [cut]]))
        let excerpt = try #require(answer.citations[1])
        #expect(excerpt.isExcerpt)
        let store = BookmarkStore(fileURL: FileManager.default.temporaryDirectory.appending(path: UUID().uuidString + ".json"))
        #expect(store.toggle(excerpt) == false)
        #expect(store.importPassages([excerpt]) == 0)
        #expect(store.count == 0)
        // The marker never travels in a link.
        #expect(ShareCodec.toWire(excerpt)["m"] == nil)
    }

    @Test func lineSeparatorInsideAnswerText() throws {
        var parser = AskEventParser()
        _ = try parser.consume(line: "event: text")
        _ = try parser.consume(line: "data: {\"text\": \"one\u{2028}two\"}")
        #expect(parser.segments == [AskSegment(text: "one\u{2028}two", cites: [])])
    }
}
