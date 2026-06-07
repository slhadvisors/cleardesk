// translations.js - Comprehensive translation system for ClearDesk
// Supports: English, Hindi (हिन्दी), Marathi (मराठी)

const translations = {
    ENGLISH: {
        // Common
        app_name: "ClearDesk",
        welcome: "Welcome to ClearDesk",
        dashboard: "Dashboard",
        logout: "Logout",
        save: "Save",
        cancel: "Cancel",
        edit: "Edit",
        delete: "Delete",
        add: "Add",
        search: "Search",
        filter: "Filter",
        export: "Export",
        settings: "Settings",
        loading: "Loading...",
        
        // Navigation
        teams: "Teams",
        agents: "Agents",
        campaigns: "Campaigns",
        contacts: "Contacts",
        calls: "Calls",
        sms: "SMS",
        developer: "Developer",
        
        // Greetings
        good_morning: "Good Morning",
        good_afternoon: "Good Afternoon",
        good_evening: "Good Evening",
        working_late: "Working late",
        
        // Roles
        role_developer: "Developer",
        role_org_admin: "Organization Admin",
        role_org_staff: "Staff",
        
        // Dashboard
        dashboard_subtitle: "Your compliance automation dashboard. Monitor agents, manage teams, and streamline your workflow.",
        total_agents: "Total Agents",
        active_teams: "Active Teams",
        compliance_rate: "Compliance Rate",
        active: "Active",
        running: "Running",
        team_management: "Team Management",
        team_management_desc: "Organize and manage your compliance teams",
        agent_details: "Agent Details",
        agent_details_desc: "View detailed agent profiles and performance",
        
        // Organization
        organization: "Organization",
        default_organization: "Default Organization",
        
        // Language
        language: "Language",
        english: "English",
        hindi: "Hindi",
        marathi: "Marathi",
        select_language: "Select Language",
        
        // Login
        staff_login: "Staff Login",
        login: "Login",
        email: "Email",
        password: "Password",
        email_placeholder: "Enter your email",
        password_placeholder: "Enter your password",
        forgot_password: "Forgot Password?",
        remember_me: "Remember me",
        
        // Teams
        team_name: "Team Name",
        team_leader: "Team Leader",
        members: "Members",
        created_on: "Created On",
        actions: "Actions",
        add_team: "Add Team",
        edit_team: "Edit Team",
        delete_team: "Delete Team",
        
        // Agents
        agent_name: "Agent Name",
        agent_id: "Agent ID",
        status: "Status",
        last_active: "Last Active",
        performance: "Performance",
        add_agent: "Add Agent",
        
        // Campaigns
        campaign_name: "Campaign Name",
        campaign_type: "Campaign Type",
        start_date: "Start Date",
        end_date: "End Date",
        total_contacts: "Total Contacts",
        completed: "Completed",
        in_progress: "In Progress",
        pending: "Pending",
        add_campaign: "Add Campaign",
        
        // Contacts
        contact_name: "Contact Name",
        phone: "Phone",
        company: "Company",
        tags: "Tags",
        add_contact: "Add Contact",
        import_contacts: "Import Contacts",
        
        // Developer Portal
        developer_portal: "Developer Portal",
        api_configuration: "API Configuration",
        llm_models: "LLM & Voice Models",
        credit_management: "Credit Management",
        webhooks: "Webhooks",
        api_keys: "API Keys",
        
        // Developer Dashboard
        dev_dashboard_title: "Developer Dashboard",
        dev_dashboard_subtitle: "Configure your AI models, manage credits, and integrate with external systems",
        active_models: "Active Models",
        total_credits: "Total Credits",
        api_calls_month: "API Calls (This Month)",
        active_webhooks: "Active Webhooks",
        quick_actions: "Quick Actions",
        configure_models: "Configure LLM Models",
        configure_models_desc: "Set up OpenAI, Anthropic, or custom AI providers",
        manage_credits: "Manage Credits",
        manage_credits_desc: "Monitor usage and set spending limits",
        setup_webhooks: "Setup Webhooks",
        setup_webhooks_desc: "Integrate with external systems via webhooks",
        generate_api_keys: "Generate API Keys",
        generate_api_keys_desc: "Create and manage API access keys",
        system_status: "System Status",
        all_systems_operational: "All systems operational",
        
        // Credits
        credit_usage: "Credit Usage",
        monthly_usage: "Monthly Usage",
        credits_used: "Credits Used",
        credits_remaining: "Remaining",
        credit_ceiling: "Credit Ceiling",
        set_ceiling: "Set Ceiling",
        alert_threshold: "Alert Threshold",
        alert_email: "Alert Email",
        usage_by_service: "Usage by Service",
        llm_api_calls: "LLM API Calls",
        voice_synthesis: "Voice Synthesis",
        sms_messages: "SMS Messages",
        phone_calls: "Phone Calls",
        
        // Models
        llm_provider: "LLM Provider",
        select_provider: "Select Provider",
        openai: "OpenAI",
        anthropic: "Anthropic",
        custom_provider: "Custom Provider",
        api_key: "API Key",
        model_selection: "Model Selection",
        temperature: "Temperature",
        voice_configuration: "Voice Configuration",
        voice_provider: "Voice Provider",
        elevenlabs: "ElevenLabs",
        google_tts: "Google TTS",
        azure_speech: "Azure Speech",
        aws_polly: "AWS Polly",
        english_voice: "English Voice",
        hindi_voice: "Hindi Voice",
        marathi_voice: "Marathi Voice",
        localization: "Localization Settings",
        default_language: "Default Language",
        auto_detect: "Auto-detect Language",
        
        // Webhooks
        webhook_name: "Webhook Name",
        webhook_url: "Webhook URL",
        event_triggers: "Event Triggers",
        authentication: "Authentication",
        contact_created: "Contact Created",
        contact_updated: "Contact Updated",
        call_completed: "Call Completed",
        sms_sent: "SMS Sent",
        campaign_finished: "Campaign Finished",
        auth_none: "None",
        auth_bearer: "Bearer Token",
        auth_api_key: "API Key",
        auth_oauth: "OAuth 2.0",
        add_webhook: "Add Webhook",
        test_webhook: "Test Webhook",
        crm_integration: "CRM Integration",
        quick_setup: "Quick Setup",
        hubspot: "HubSpot",
        salesforce: "Salesforce",
        zoho: "Zoho CRM",
        
        // API Keys
        generate_new_key: "Generate New API Key",
        key_name: "Key Name",
        permissions: "Permissions",
        expiration: "Expiration",
        never: "Never",
        days_30: "30 Days",
        days_90: "90 Days",
        days_365: "1 Year",
        campaigns_read: "Campaigns (Read)",
        campaigns_write: "Campaigns (Write)",
        contacts_read: "Contacts (Read)",
        contacts_write: "Contacts (Write)",
        logs_read: "Logs (Read)",
        your_api_keys: "Your API Keys",
        created: "Created",
        expires: "Expires",
        revoke: "Revoke",
        api_documentation: "API Documentation",
        
        // Time periods
        hours_24: "24h",
        days_7: "7d",
        days_30: "30d",
        this_month: "This Month",
        
        // Status
        active_status: "Active",
        inactive: "Inactive",
        paused: "Paused",
    },
    
    HINDI: {
        // Common
        app_name: "क्लियरडेस्क",
        welcome: "क्लियरडेस्क में आपका स्वागत है",
        dashboard: "डैशबोर्ड",
        logout: "लॉग आउट",
        save: "सहेजें",
        cancel: "रद्द करें",
        edit: "संपादित करें",
        delete: "हटाएं",
        add: "जोड़ें",
        search: "खोजें",
        filter: "फ़िल्टर",
        export: "निर्यात",
        settings: "सेटिंग्स",
        loading: "लोड हो रहा है...",
        
        // Navigation
        teams: "टीमें",
        agents: "एजेंट",
        campaigns: "अभियान",
        contacts: "संपर्क",
        calls: "कॉल",
        sms: "एसएमएस",
        developer: "डेवलपर",
        
        // Greetings
        good_morning: "सुप्रभात",
        good_afternoon: "शुभ दोपहर",
        good_evening: "शुभ संध्या",
        working_late: "देर से काम",
        
        // Roles
        role_developer: "डेवलपर",
        role_org_admin: "संगठन व्यवस्थापक",
        role_org_staff: "कर्मचारी",
        
        // Dashboard
        dashboard_subtitle: "आपका अनुपालन स्वचालन डैशबोर्ड। एजेंटों की निगरानी करें, टीमों का प्रबंधन करें, और अपने वर्कफ़्लो को सुव्यवस्थित करें।",
        total_agents: "कुल एजेंट",
        active_teams: "सक्रिय टीमें",
        compliance_rate: "अनुपालन दर",
        active: "सक्रिय",
        running: "चल रहा है",
        team_management: "टीम प्रबंधन",
        team_management_desc: "अपनी अनुपालन टीमों को व्यवस्थित और प्रबंधित करें",
        agent_details: "एजेंट विवरण",
        agent_details_desc: "विस्तृत एजेंट प्रोफ़ाइल और प्रदर्शन देखें",
        
        // Organization
        organization: "संगठन",
        default_organization: "डिफ़ॉल्ट संगठन",
        
        // Language
        language: "भाषा",
        english: "अंग्रेज़ी",
        hindi: "हिन्दी",
        marathi: "मराठी",
        select_language: "भाषा चुनें",
        
        // Login
        staff_login: "कर्मचारी लॉगिन",
        login: "लॉगिन",
        email: "ईमेल",
        password: "पासवर्ड",
        email_placeholder: "अपना ईमेल दर्ज करें",
        password_placeholder: "अपना पासवर्ड दर्ज करें",
        forgot_password: "पासवर्ड भूल गए?",
        remember_me: "मुझे याद रखें",
        
        // Teams
        team_name: "टीम का नाम",
        team_leader: "टीम लीडर",
        members: "सदस्य",
        created_on: "निर्मित दिनांक",
        actions: "कार्रवाई",
        add_team: "टीम जोड़ें",
        edit_team: "टीम संपादित करें",
        delete_team: "टीम हटाएं",
        
        // Agents
        agent_name: "एजेंट का नाम",
        agent_id: "एजेंट आईडी",
        status: "स्थिति",
        last_active: "अंतिम सक्रिय",
        performance: "प्रदर्शन",
        add_agent: "एजेंट जोड़ें",
        
        // Campaigns
        campaign_name: "अभियान का नाम",
        campaign_type: "अभियान प्रकार",
        start_date: "आरंभ तिथि",
        end_date: "समाप्ति तिथि",
        total_contacts: "कुल संपर्क",
        completed: "पूर्ण",
        in_progress: "प्रगति में",
        pending: "लंबित",
        add_campaign: "अभियान जोड़ें",
        
        // Contacts
        contact_name: "संपर्क नाम",
        phone: "फ़ोन",
        company: "कंपनी",
        tags: "टैग",
        add_contact: "संपर्क जोड़ें",
        import_contacts: "संपर्क आयात करें",
        
        // Developer Portal
        developer_portal: "डेवलपर पोर्टल",
        api_configuration: "एपीआई कॉन्फ़िगरेशन",
        llm_models: "एलएलएम और वॉइस मॉडल",
        credit_management: "क्रेडिट प्रबंधन",
        webhooks: "वेबहुक",
        api_keys: "एपीआई कुंजी",
        
        // Developer Dashboard
        dev_dashboard_title: "डेवलपर डैशबोर्ड",
        dev_dashboard_subtitle: "अपने एआई मॉडल कॉन्फ़िगर करें, क्रेडिट प्रबंधित करें, और बाहरी सिस्टम के साथ एकीकृत करें",
        active_models: "सक्रिय मॉडल",
        total_credits: "कुल क्रेडिट",
        api_calls_month: "एपीआई कॉल (यह महीना)",
        active_webhooks: "सक्रिय वेबहुक",
        quick_actions: "त्वरित कार्रवाई",
        configure_models: "एलएलएम मॉडल कॉन्फ़िगर करें",
        configure_models_desc: "OpenAI, Anthropic, या कस्टम एआई प्रदाता सेट करें",
        manage_credits: "क्रेडिट प्रबंधित करें",
        manage_credits_desc: "उपयोग की निगरानी करें और खर्च सीमा निर्धारित करें",
        setup_webhooks: "वेबहुक सेटअप करें",
        setup_webhooks_desc: "वेबहुक के माध्यम से बाहरी सिस्टम के साथ एकीकृत करें",
        generate_api_keys: "एपीआई कुंजी उत्पन्न करें",
        generate_api_keys_desc: "एपीआई एक्सेस कुंजी बनाएं और प्रबंधित करें",
        system_status: "सिस्टम स्थिति",
        all_systems_operational: "सभी सिस्टम परिचालन",
        
        // Credits
        credit_usage: "क्रेडिट उपयोग",
        monthly_usage: "मासिक उपयोग",
        credits_used: "उपयोग किए गए क्रेडिट",
        credits_remaining: "शेष",
        credit_ceiling: "क्रेडिट सीमा",
        set_ceiling: "सीमा निर्धारित करें",
        alert_threshold: "अलर्ट थ्रेशोल्ड",
        alert_email: "अलर्ट ईमेल",
        usage_by_service: "सेवा के अनुसार उपयोग",
        llm_api_calls: "एलएलएम एपीआई कॉल",
        voice_synthesis: "वॉइस सिंथेसिस",
        sms_messages: "एसएमएस संदेश",
        phone_calls: "फ़ोन कॉल",
        
        // Models
        llm_provider: "एलएलएम प्रदाता",
        select_provider: "प्रदाता चुनें",
        openai: "OpenAI",
        anthropic: "Anthropic",
        custom_provider: "कस्टम प्रदाता",
        api_key: "एपीआई कुंजी",
        model_selection: "मॉडल चयन",
        temperature: "तापमान",
        voice_configuration: "वॉइस कॉन्फ़िगरेशन",
        voice_provider: "वॉइस प्रदाता",
        elevenlabs: "ElevenLabs",
        google_tts: "Google TTS",
        azure_speech: "Azure Speech",
        aws_polly: "AWS Polly",
        english_voice: "अंग्रेजी वॉइस",
        hindi_voice: "हिन्दी वॉइस",
        marathi_voice: "मराठी वॉइस",
        localization: "स्थानीयकरण सेटिंग्स",
        default_language: "डिफ़ॉल्ट भाषा",
        auto_detect: "भाषा स्वतः पहचानें",
        
        // Webhooks
        webhook_name: "वेबहुक नाम",
        webhook_url: "वेबहुक URL",
        event_triggers: "इवेंट ट्रिगर",
        authentication: "प्रमाणीकरण",
        contact_created: "संपर्क बनाया गया",
        contact_updated: "संपर्क अपडेट किया गया",
        call_completed: "कॉल पूर्ण",
        sms_sent: "एसएमएस भेजा गया",
        campaign_finished: "अभियान समाप्त",
        auth_none: "कोई नहीं",
        auth_bearer: "बियरर टोकन",
        auth_api_key: "एपीआई कुंजी",
        auth_oauth: "OAuth 2.0",
        add_webhook: "वेबहुक जोड़ें",
        test_webhook: "वेबहुक परीक्षण",
        crm_integration: "सीआरएम एकीकरण",
        quick_setup: "त्वरित सेटअप",
        hubspot: "HubSpot",
        salesforce: "Salesforce",
        zoho: "Zoho CRM",
        
        // API Keys
        generate_new_key: "नई एपीआई कुंजी उत्पन्न करें",
        key_name: "कुंजी नाम",
        permissions: "अनुमतियाँ",
        expiration: "समाप्ति",
        never: "कभी नहीं",
        days_30: "30 दिन",
        days_90: "90 दिन",
        days_365: "1 वर्ष",
        campaigns_read: "अभियान (पढ़ें)",
        campaigns_write: "अभियान (लिखें)",
        contacts_read: "संपर्क (पढ़ें)",
        contacts_write: "संपर्क (लिखें)",
        logs_read: "लॉग (पढ़ें)",
        your_api_keys: "आपकी एपीआई कुंजियाँ",
        created: "निर्मित",
        expires: "समाप्त होता है",
        revoke: "रद्द करें",
        api_documentation: "एपीआई दस्तावेज़ीकरण",
        
        // Time periods
        hours_24: "24घंटे",
        days_7: "7दिन",
        days_30: "30दिन",
        this_month: "यह महीना",
        
        // Status
        active_status: "सक्रिय",
        inactive: "निष्क्रिय",
        paused: "रोका गया",
    },
    
    MARATHI: {
        // Common
        app_name: "क्लियरडेस्क",
        welcome: "क्लियरडेस्कमध्ये आपले स्वागत आहे",
        dashboard: "डॅशबोर्ड",
        logout: "लॉग आउट",
        save: "जतन करा",
        cancel: "रद्द करा",
        edit: "संपादित करा",
        delete: "हटवा",
        add: "जोडा",
        search: "शोधा",
        filter: "फिल्टर",
        export: "निर्यात",
        settings: "सेटिंग्ज",
        loading: "लोड होत आहे...",
        
        // Navigation
        teams: "टीम",
        agents: "एजंट",
        campaigns: "मोहिम",
        contacts: "संपर्क",
        calls: "कॉल",
        sms: "एसएमएस",
        developer: "डेव्हलपर",
        
        // Greetings
        good_morning: "सुप्रभात",
        good_afternoon: "शुभ दुपार",
        good_evening: "शुभ संध्याकाळ",
        working_late: "उशीरापर्यंत काम",
        
        // Roles
        role_developer: "डेव्हलपर",
        role_org_admin: "संस्था व्यवस्थापक",
        role_org_staff: "कर्मचारी",
        
        // Dashboard
        dashboard_subtitle: "तुमचा अनुपालन ऑटोमेशन डॅशबोर्ड. एजंटांचे निरीक्षण करा, टीम व्यवस्थापित करा आणि तुमचा वर्कफ्लो सुव्यवस्थित करा.",
        total_agents: "एकूण एजंट",
        active_teams: "सक्रिय टीम",
        compliance_rate: "अनुपालन दर",
        active: "सक्रिय",
        running: "चालू आहे",
        team_management: "टीम व्यवस्थापन",
        team_management_desc: "तुमच्या अनुपालन टीमची व्यवस्था करा आणि व्यवस्थापित करा",
        agent_details: "एजंट तपशील",
        agent_details_desc: "तपशीलवार एजंट प्रोफाइल आणि कार्यप्रदर्शन पहा",
        
        // Organization
        organization: "संस्था",
        default_organization: "डीफॉल्ट संस्था",
        
        // Language
        language: "भाषा",
        english: "इंग्रजी",
        hindi: "हिंदी",
        marathi: "मराठी",
        select_language: "भाषा निवडा",
        
        // Login
        staff_login: "कर्मचारी लॉगिन",
        login: "लॉगिन",
        email: "ईमेल",
        password: "पासवर्ड",
        email_placeholder: "तुमचा ईमेल प्रविष्ट करा",
        password_placeholder: "तुमचा पासवर्ड प्रविष्ट करा",
        forgot_password: "पासवर्ड विसरलात?",
        remember_me: "मला लक्षात ठेवा",
        
        // Teams
        team_name: "टीमचे नाव",
        team_leader: "टीम लीडर",
        members: "सदस्य",
        created_on: "तयार केले",
        actions: "कृती",
        add_team: "टीम जोडा",
        edit_team: "टीम संपादित करा",
        delete_team: "टीम हटवा",
        
        // Agents
        agent_name: "एजंटचे नाव",
        agent_id: "एजंट आयडी",
        status: "स्थिती",
        last_active: "शेवटचे सक्रिय",
        performance: "कार्यप्रदर्शन",
        add_agent: "एजंट जोडा",
        
        // Campaigns
        campaign_name: "मोहिमेचे नाव",
        campaign_type: "मोहीम प्रकार",
        start_date: "प्रारंभ तारीख",
        end_date: "समाप्ती तारीख",
        total_contacts: "एकूण संपर्क",
        completed: "पूर्ण",
        in_progress: "प्रगतीपथावर",
        pending: "प्रलंबित",
        add_campaign: "मोहीम जोडा",
        
        // Contacts
        contact_name: "संपर्क नाव",
        phone: "फोन",
        company: "कंपनी",
        tags: "टॅग",
        add_contact: "संपर्क जोडा",
        import_contacts: "संपर्क आयात करा",
        
        // Developer Portal
        developer_portal: "डेव्हलपर पोर्टल",
        api_configuration: "एपीआय कॉन्फिगरेशन",
        llm_models: "एलएलएम आणि व्हॉइस मॉडेल",
        credit_management: "क्रेडिट व्यवस्थापन",
        webhooks: "वेबहुक",
        api_keys: "एपीआय की",
        
        // Developer Dashboard
        dev_dashboard_title: "डेव्हलपर डॅशबोर्ड",
        dev_dashboard_subtitle: "तुमचे एआय मॉडेल कॉन्फिगर करा, क्रेडिट व्यवस्थापित करा आणि बाह्य सिस्टमसह एकत्रित करा",
        active_models: "सक्रिय मॉडेल",
        total_credits: "एकूण क्रेडिट",
        api_calls_month: "एपीआय कॉल (हा महिना)",
        active_webhooks: "सक्रिय वेबहुक",
        quick_actions: "द्रुत कृती",
        configure_models: "एलएलएम मॉडेल कॉन्फिगर करा",
        configure_models_desc: "OpenAI, Anthropic किंवा सानुकूल एआय प्रदाता सेट करा",
        manage_credits: "क्रेडिट व्यवस्थापित करा",
        manage_credits_desc: "वापराचे निरीक्षण करा आणि खर्च मर्यादा सेट करा",
        setup_webhooks: "वेबहुक सेटअप करा",
        setup_webhooks_desc: "वेबहुकद्वारे बाह्य सिस्टमसह एकत्रित करा",
        generate_api_keys: "एपीआय की तयार करा",
        generate_api_keys_desc: "एपीआय ऍक्सेस की तयार करा आणि व्यवस्थापित करा",
        system_status: "सिस्टम स्थिती",
        all_systems_operational: "सर्व प्रणाली कार्यरत",
        
        // Credits
        credit_usage: "क्रेडिट वापर",
        monthly_usage: "मासिक वापर",
        credits_used: "वापरलेले क्रेडिट",
        credits_remaining: "उर्वरित",
        credit_ceiling: "क्रेडिट मर्यादा",
        set_ceiling: "मर्यादा सेट करा",
        alert_threshold: "सूचना थ्रेशोल्ड",
        alert_email: "सूचना ईमेल",
        usage_by_service: "सेवेनुसार वापर",
        llm_api_calls: "एलएलएम एपीआय कॉल",
        voice_synthesis: "व्हॉइस सिंथेसिस",
        sms_messages: "एसएमएस संदेश",
        phone_calls: "फोन कॉल",
        
        // Models
        llm_provider: "एलएलएम प्रदाता",
        select_provider: "प्रदाता निवडा",
        openai: "OpenAI",
        anthropic: "Anthropic",
        custom_provider: "सानुकूल प्रदाता",
        api_key: "एपीआय की",
        model_selection: "मॉडेल निवड",
        temperature: "तापमान",
        voice_configuration: "व्हॉइस कॉन्फिगरेशन",
        voice_provider: "व्हॉइस प्रदाता",
        elevenlabs: "ElevenLabs",
        google_tts: "Google TTS",
        azure_speech: "Azure Speech",
        aws_polly: "AWS Polly",
        english_voice: "इंग्रजी व्हॉइस",
        hindi_voice: "हिंदी व्हॉइस",
        marathi_voice: "मराठी व्हॉइस",
        localization: "स्थानिकीकरण सेटिंग्ज",
        default_language: "डीफॉल्ट भाषा",
        auto_detect: "भाषा स्वयं शोधा",
        
        // Webhooks
        webhook_name: "वेबहुक नाव",
        webhook_url: "वेबहुक URL",
        event_triggers: "इव्हेंट ट्रिगर",
        authentication: "प्रमाणीकरण",
        contact_created: "संपर्क तयार केला",
        contact_updated: "संपर्क अपडेट केला",
        call_completed: "कॉल पूर्ण",
        sms_sent: "एसएमएस पाठवला",
        campaign_finished: "मोहीम समाप्त",
        auth_none: "काहीही नाही",
        auth_bearer: "बियरर टोकन",
        auth_api_key: "एपीआय की",
        auth_oauth: "OAuth 2.0",
        add_webhook: "वेबहुक जोडा",
        test_webhook: "वेबहुक चाचणी",
        crm_integration: "सीआरएम एकत्रीकरण",
        quick_setup: "द्रुत सेटअप",
        hubspot: "HubSpot",
        salesforce: "Salesforce",
        zoho: "Zoho CRM",
        
        // API Keys
        generate_new_key: "नवीन एपीआय की तयार करा",
        key_name: "की नाव",
        permissions: "परवानग्या",
        expiration: "समाप्ती",
        never: "कधीही नाही",
        days_30: "30 दिवस",
        days_90: "90 दिवस",
        days_365: "1 वर्ष",
        campaigns_read: "मोहिम (वाचा)",
        campaigns_write: "मोहिम (लिहा)",
        contacts_read: "संपर्क (वाचा)",
        contacts_write: "संपर्क (लिहा)",
        logs_read: "लॉग (वाचा)",
        your_api_keys: "तुमच्या एपीआय की",
        created: "तयार केले",
        expires: "समाप्त होते",
        revoke: "रद्द करा",
        api_documentation: "एपीआय दस्तऐवजीकरण",
        
        // Time periods
        hours_24: "24तास",
        days_7: "7दिवस",
        days_30: "30दिवस",
        this_month: "हा महिना",
        
        // Status
        active_status: "सक्रिय",
        inactive: "निष्क्रिय",
        paused: "थांबवले",
    }
};

// Translation helper function
function t(key, language = 'ENGLISH') {
    const lang = language.toUpperCase();
    return translations[lang]?.[key] || translations.ENGLISH[key] || key;
}

// Get current language from user preferences
function getCurrentLanguage() {
    const storedLang = localStorage.getItem('preferredLanguage');
    return storedLang || 'ENGLISH';
}

// Set language preference
function setLanguage(language) {
    localStorage.setItem('preferredLanguage', language.toUpperCase());
    location.reload(); // Reload to apply translations
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { translations, t, getCurrentLanguage, setLanguage };
}